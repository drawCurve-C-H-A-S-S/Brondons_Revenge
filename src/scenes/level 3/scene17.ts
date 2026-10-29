import {
  playSfx,
  updateWaterfallAudio,
  stopWaterfallAudio,
} from "../../helpers/audio/sfx.js";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import {
  createScenePhysics,
  createGroundMotor,
  PHYSICS,
  registerPhysicsActor,
} from "../../helpers/physics/scenePhysics.js";
import {
  createRescueSite,
  RESCUE_SITE,
  JUNGLE_PATH,
  JUNGLE_ROUTE,
  JUNGLE_ENTRY_YAW,
  ARCADE_JUNGLE_SPAWN,
  ARCADE_JUNGLE_ROUTE,
  type RescueArrival,
  type WaterfallCharacterContact,
} from "../../scripts/global/rescueSite.js";
import {
  createPlayer,
  type PlayerTransitionState,
} from "../../scripts/player/player.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  loadToolModel,
  loadDinoModel,
  loadSharkModel,
} from "../../core/loader.js";
import { disposeRoom } from "../../scripts/global/shipRoom.js";
import { emitComicEffect } from "../../scripts/global/comicEffects.js";
import type {
  DamageTarget,
  DamageWeapon,
} from "../../scripts/weapons/pistol.js";
import type { CinematicPose } from "../../scripts/player/characterManager.js";
import {
  PARRY_DAMAGE,
  type ParryableBolt,
} from "../../scripts/weapons/bloomstick.js";
import { createRiverAmbushers } from "../../scripts/npc/riverAmbusher.js";
import { createWaterfallMiniboss } from "../../scripts/npc/waterfallMiniboss.js";
import {
  KNOCKDOWN_DURATION,
  knockdownTilt,
} from "../../scripts/npc/knockdown.js";

/** One uninterrupted landing-site, bridge, waterfall and facility exterior. */
export function createScene({
  entryState,
  fromFacility = false,
  arcadeMode = false,
  onArcadeComplete,
  onRespawn,
  onFinished,
  loadModel = loadToolModel,
  loadDinosaur = loadDinoModel,
  loadShark = loadSharkModel,
}: {
  entryState?: RescueArrival;
  onRespawn: (state: RescueArrival) => void;
  fromFacility?: boolean;
  arcadeMode?: boolean;
  onArcadeComplete?: () => void;
  onFinished?: (state: RescueArrival) => void;
  loadModel?: typeof loadToolModel;
  loadDinosaur?: typeof loadDinoModel;
  loadShark?: typeof loadSharkModel;
}) {
  const spawn = arcadeMode ? ARCADE_JUNGLE_SPAWN : RESCUE_SITE.player;
  const spawnYaw = arcadeMode
    ? Math.atan2(
        spawn.x - ARCADE_JUNGLE_ROUTE[1].x,
        spawn.z - ARCADE_JUNGLE_ROUTE[1].z,
      )
    : JUNGLE_ENTRY_YAW;
  const patrolRoute = arcadeMode ? ARCADE_JUNGLE_ROUTE : JUNGLE_ROUTE;
  const arcadeEnemyLimit = 4,
    arcadeAttackLimit = 4,
    trailHalfWidth = 3.5;
  const arcadeTrail = arcadeMode
    ? ARCADE_JUNGLE_ROUTE.filter((point, index) => index % 8 === 0 && point.x > -84)
        .map((point) => point.clone())
    : [];
  if (arcadeMode) arcadeTrail.push(new THREE.Vector3(-84, 0, 17));
  function nearestTrail(position: { x: number; z: number }) {
    let x = spawn.x, z = spawn.z, squared = Infinity;
    for (let i = 1; i < arcadeTrail.length; i++) {
      const a = arcadeTrail[i - 1], b = arcadeTrail[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(
        ((position.x - a.x) * dx + (position.z - a.z) * dz) / (dx * dx + dz * dz),
        0, 1,
      );
      const px = a.x + dx * t, pz = a.z + dz * t;
      const distance = (position.x - px) ** 2 + (position.z - pz) ** 2;
      if (distance < squared) {
        x = px;
        z = pz;
        squared = distance;
      }
    }
    return { x, z, squared };
  }
  function onArcadeTrail(position: { x: number; z: number }, margin = 0) {
    if (
      position.x >= -106 + margin && position.x <= -84 &&
      position.z >= 9 + margin && position.z <= 25 - margin
    ) return true;
    const first = arcadeTrail[0], next = arcadeTrail[1];
    if ((position.x - first.x) * (next.x - first.x) +
        (position.z - first.z) * (next.z - first.z) < 0) return false;
    return nearestTrail(position).squared <= (trailHalfWidth - margin) ** 2;
  }
  const physics = createScenePhysics(),
    physicsWorld = physics.world;
  const site = createRescueSite(physics, {
      culling: true,
      includeNarrativeProps: !arcadeMode,
      arcadeTrail: arcadeMode,
    }),
    { scene, door, ship, pod, boy } = site;
  if (arcadeMode) {
    for (const prop of [ship.root, pod, boy]) {
      site.releasePropCulling(prop);
      prop.visible = false;
    }
    door.setLocked(true);
    const steel = new THREE.MeshStandardMaterial({
      color: 0x35444c,
      roughness: 0.55,
      metalness: 0.8,
    });
    const warning = new THREE.MeshStandardMaterial({
      color: 0xe9b83b,
      roughness: 0.7,
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot create the Arcade trail fence");
    context.fillStyle = "#75877b";
    context.fillRect(0, 0, 32, 32);
    context.clearRect(4, 4, 24, 24);
    const fenceTexture = new THREE.CanvasTexture(canvas);
    fenceTexture.wrapS = fenceTexture.wrapT = THREE.RepeatWrapping;
    fenceTexture.repeat.set(10, 6);
    const fenceMaterial = new THREE.MeshStandardMaterial({
      color: 0x879a8b,
      map: fenceTexture,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const left: THREE.Vector3[] = [], right: THREE.Vector3[] = [];
    arcadeTrail.forEach((point, index) => {
      const before = arcadeTrail[Math.max(0, index - 1)];
      const after = arcadeTrail[Math.min(arcadeTrail.length - 1, index + 1)];
      const incoming = point.clone().sub(before);
      const outgoing = after.clone().sub(point);
      if (!incoming.lengthSq()) incoming.copy(outgoing);
      if (!outgoing.lengthSq()) outgoing.copy(incoming);
      incoming.normalize();
      outgoing.normalize();
      const normal = new THREE.Vector3(-incoming.z, 0, incoming.x);
      const miter = normal.clone().add(new THREE.Vector3(-outgoing.z, 0, outgoing.x)).normalize();
      miter.multiplyScalar(trailHalfWidth / Math.max(0.5, miter.dot(normal)));
      left.push(point.clone().add(miter));
      right.push(point.clone().sub(miter));
    });
    const rearOffset = arcadeTrail[0].clone().sub(arcadeTrail[1]).normalize().multiplyScalar(0.6);
    left[0].add(rearOffset);
    right[0].add(rearOffset);
    const walls: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (let i = 1; i < arcadeTrail.length; i++)
      walls.push([left[i - 1], left[i]], [right[i - 1], right[i]]);
    walls.push([left[0], right[0]]);
    for (const [ax, az, bx, bz] of [
      [-106, 9, -84, 9], [-106, 25, -84, 25], [-106, 9, -106, 25],
      [-84, 9, -84, 13.5], [-84, 20.5, -84, 25],
    ])
      walls.push([new THREE.Vector3(ax, 0, az), new THREE.Vector3(bx, 0, bz)]);
    let gateIndex = 0, gateDistance = Infinity;
    walls.forEach(([a, b], index) => {
      const distance = Math.hypot(
        (a.x + b.x) / 2 - RESCUE_SITE.bridge.x,
        (a.z + b.z) / 2 - RESCUE_SITE.bridge.z,
      );
      if (distance < gateDistance) {
        gateIndex = index;
        gateDistance = distance;
      }
    });
    walls.forEach(([a, b], index) => {
      const gate = index === gateIndex;
      const wall = new THREE.Group();
      wall.name = gate ? "ArcadeBridgeGate" : "ArcadeTrailFence";
      wall.position.copy(a).add(b).multiplyScalar(0.5);
      wall.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      const panel = new THREE.Mesh(boxGeometry, gate ? steel : fenceMaterial);
      panel.scale.set(a.distanceTo(b) + 0.12, 5, 0.35);
      panel.position.y = 2.5;
      wall.add(panel);
      if (gate)
        for (const y of [0.6, 2.5, 4.4]) {
          const brace = new THREE.Mesh(boxGeometry, warning);
          brace.scale.set(panel.scale.x, 0.18, 0.4);
          brace.position.y = y;
          wall.add(brace);
        }
      scene.add(wall);
      site.trackStaticBody(physics.addBoxFromMesh(panel));
    });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x64695e, roughness: 1 });
    const floors = new THREE.InstancedMesh(boxGeometry, floorMaterial, arcadeTrail.length - 1);
    floors.name = "ArcadeTrailSafetyDeck";
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    for (let i = 1; i < arcadeTrail.length; i++) {
      const a = arcadeTrail[i - 1], b = arcadeTrail[i];
      const size = new THREE.Vector3(trailHalfWidth * 2 + 0.4, 0.3, a.distanceTo(b) + 0.4);
      const position = a.clone().add(b).multiplyScalar(0.5).setY(-0.13);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      matrix.compose(position, rotation, size);
      floors.setMatrixAt(i - 1, matrix);
      const body = physics.addBox(size, position);
      body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      body.aabbNeedsUpdate = true;
      site.trackStaticBody(body);
    }
    scene.add(floors);
  }
  const doorwayVoid = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3.2),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  doorwayVoid.name = "FacilityDoorwayBlackVoid";
  doorwayVoid.position.set(0, 1.6, -0.18);
  door.group.add(doorwayVoid);
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.05,
    650,
  );
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  const waterfallContact: WaterfallCharacterContact = {
    position: player.body.position,
    headY: player.getHeadY(),
    radius: player.radius,
  };
  if (entryState?.pilotState && fromFacility) {
    player.restoreTransition(
      {
        ...entryState.pilotState,
        velocity: new THREE.Vector3(),
        heldKeys: [],
        blockedKeys: entryState.pilotState.heldKeys,
        sprinting: false,
        crouching: false,
        intentionalJump: false,
        jumpQueued: false,
        slide: undefined,
        bobIntensity: 0,
      },
      door.frame,
    );
    door.openImmediately();
  } else if (entryState?.pilotState)
    player.restoreTransition(
      {
        ...entryState.pilotState,
        position: spawn,
        velocity: { x: 0, y: 0, z: 0 },
        yaw: spawnYaw,
        pitch: 0,
        heldKeys: [],
        blockedKeys: [],
        crouching: false,
        sprinting: false,
        intentionalJump: false,
        jumpQueued: false,
        bobTime: 0,
        bobIntensity: 0,
      },
      { x: 0, y: 0, z: 0, yaw: -Math.PI },
    );
  if (!fromFacility) player.setRotation(spawnYaw);
  player.enable();
  player.updateCamera(0);
  ship.setCanopyOpen(1);
  ship.setFlying(false, true);
  ship.root.userData.hullHealth = entryState?.hullHealth;
  pod.getObjectByName("PodHatch")!.rotation.z = -1.5;
  boy.rotation.y = Math.atan2(
    RESCUE_SITE.player.x - boy.position.x,
    RESCUE_SITE.player.z - boy.position.z,
  );
  site.setImpact(arcadeMode ? -1 : 30);
  ship.update(0);
  for (const prop of arcadeMode ? [] : [ship.root, pod]) {
    prop.updateMatrixWorld(true);
    const body = new CANNON.Body({ mass: 0, material: physics.solidMaterial });
    body.position.copy(
      new CANNON.Vec3(prop.position.x, prop.position.y, prop.position.z),
    );
    prop.traverse((node) => {
      if (
        !(node instanceof THREE.Mesh) ||
        !(node.material instanceof THREE.MeshStandardMaterial) ||
        node.material.transparent
      )
        return;
      const positions = node.geometry.getAttribute("position"),
        index = node.geometry.getIndex();
      const vertices: number[] = [],
        vertex = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        vertex
          .fromBufferAttribute(positions, i)
          .applyMatrix4(node.matrixWorld)
          .sub(prop.position);
        vertices.push(vertex.x, vertex.y, vertex.z);
      }
      const indices = Array.from(
        { length: index?.count ?? positions.count },
        (_, i): number => (index ? index.getX(i) : i),
      );
      body.addShape(new CANNON.Trimesh(vertices, indices));
    });
    physicsWorld.addBody(body);
    site.trackStaticBody(body);
  }
  const brendanBody = arcadeMode ? null : physics.addBox(
    { x: 0.55, y: 1.75, z: 0.55 },
    { x: RESCUE_SITE.boy.x, y: 0.875, z: RESCUE_SITE.boy.z },
  );
  if (brendanBody) site.trackStaticBody(brendanBody);
  // Use the final render camera, including third-person offsets, without advancing simulation.
  scene.onBeforeRender = (_renderer, _scene, viewCamera) =>
    site.updateVisibility(viewCamera, player.body.position);

  const status = document.getElementById("loading-bay-status");
  const caption = document.getElementById("space-cinematic-caption");
  const prompt = document.getElementById("interact-prompt");
  document.body.classList.remove("space-cinematic");
  status?.classList.remove("hidden", "restored");
  caption?.classList.add("hidden");
  prompt?.classList.add("hidden");
  let disposed = false,
    alerted = false,
    doorLatched = false,
    completed = false,
    deathClock = 0;
  let elapsed = 0,
    arrivalClock = 0,
    paused = false,
    animationDelta = 0;
  let sharkClock = -1,
    sharkLoadError = false;
  const sharkDeathAt = 4.2;
  const riverEntry = new THREE.Vector3(),
    riverCamera = new THREE.Vector3(),
    riverRotation = new THREE.Quaternion();
  const miniboss = createWaterfallMiniboss({
    scene,
    world: physicsWorld,
    player,
    camera,
    arena: site.waterfall,
    defeated: arcadeMode ? false : entryState?.waterfallDefeated,
    achievementUnlocked: entryState?.waterfallAchievementUnlocked,
    onDefeated: arcadeMode ? finishArcadeRun : undefined,
    loadModel,
  });
  const landSquad = createRiverAmbushers(scene, arcadeMode ? [] : [125, 125, 125], loadModel);
  const sentries = landSquad.actors.map((actor, index) => {
    const home = JUNGLE_PATH.getPointAt([0.63, 0.74, 0.84][index]);
    actor.root.name = `PostBridgeSpiderBot${index + 1}`;
    const body = new CANNON.Body({
      mass: 25,
      shape: new CANNON.Sphere(0.85),
      fixedRotation: true,
      allowSleep: false,
      linearDamping: 0,
      material: new CANNON.Material({ friction: 0, restitution: 0 }),
    });
    actor.root.visible = false;
    return {
      actor,
      body,
      home,
      motor: createGroundMotor(body, 0.85),
      active: false,
      spent: false,
      aim: new THREE.Vector3(),
      steering: new THREE.Vector3(),
      steeringClock: 0,
      cooldown: 2 + index * 0.7,
      charge: -1,
    };
  });
  const onBlur = () => {
      paused = true;
    },
    onFocus = () => {
      paused = false;
    };
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  let spawnClock = 3,
    dinoSpawnClock = 0,
    patrolLoaded = false,
    patrolLoadError = false,
    dinoLoadError = false,
    defeatedPatrols = 0;
  let dinoReady: Promise<void> | null = null;
  function nearestPatrolPoint(x: number, z: number) {
    if (!arcadeMode) return site.nearestPathPoint(x, z);
    let index = 0, distance = Infinity;
    patrolRoute.forEach((point, candidate) => {
      const squared = (point.x - x) ** 2 + (point.z - z) ** 2;
      if (squared < distance) {
        index = candidate;
        distance = squared;
      }
    });
    return { index, distance: Math.sqrt(distance) };
  }
  let playerRoute = nearestPatrolPoint(
    player.body.position.x,
    player.body.position.z,
  );
  const sharks: Array<{
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    homeX: number;
    baseY: number;
    phase: number;
    start: THREE.Vector3;
    attackIndex: number;
  }> = [];
  const sharkReady = arcadeMode ? Promise.resolve() : loadShark()
    .then((asset) => {
      if (disposed) {
        releaseTemplate(asset.scene);
        return;
      }
      const normalized = new THREE.Group();
      normalized.add(asset.scene);
      const sampler = new THREE.AnimationMixer(asset.scene);
      if (asset.animations[0]) {
        sampler.clipAction(asset.animations[0]).play();
        sampler.update(0);
      }
      const bounds = new THREE.Box3().setFromObject(normalized),
        size = bounds.getSize(new THREE.Vector3());
      if (size.y > Math.max(size.x, size.z)) {
        normalized.rotation.x = -Math.PI / 2;
        bounds.setFromObject(normalized);
        bounds.getSize(size);
      }
      sampler.stopAllAction();
      sampler.uncacheRoot(asset.scene);
      const length = Math.max(size.x, size.z);
      if (!Number.isFinite(length) || length <= 0) {
        releaseTemplate(asset.scene);
        throw new Error("River shark has empty geometry");
      }
      const center = bounds.getCenter(new THREE.Vector3()),
        scale = Math.min(2.7 / length, 1.15 / Math.max(size.y, 0.01));
      normalized.scale.setScalar(scale);
      normalized.position.copy(center).multiplyScalar(-scale);
      bounds.setFromObject(normalized);
      const finHeight = bounds.max.y;
      normalized.visible = false;
      scene.add(normalized);
      for (const [index, x] of [-70, -57, -36, -17, 4, 27, 51].entries()) {
        const root = new THREE.Group(),
          model = clone(normalized);
        model.visible = true;
        const baseY = RESCUE_SITE.riverY - finHeight + 0.1;
        root.name = `RiverShark${index + 1}`;
        root.add(model);
        root.position.set(x, baseY, RESCUE_SITE.riverZ + (index % 2 ? 4 : -4));
        scene.add(root);
        const mixer = new THREE.AnimationMixer(model);
        if (asset.animations[0]) mixer.clipAction(asset.animations[0]).play();
        sharks.push({
          root,
          mixer,
          homeX: x,
          baseY,
          phase: index * 1.7,
          start: new THREE.Vector3(),
          attackIndex: -1,
        });
      }
    })
    .catch((error) => {
      if (!disposed) {
        sharkLoadError = true;
        console.error("[Scene 17] Could not load river sharks:", error);
      }
    });
  type JungleEnemy = {
    root: THREE.Group;
    body: CANNON.Body;
    motor: ReturnType<typeof createGroundMotor>;
    mixer: THREE.AnimationMixer;
    actions: Map<string, THREE.AnimationAction>;
    action: string;
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    phase:
      | "dormant"
      | "spawning"
      | "chasing"
      | "attacking"
      | "hit"
      | "dying"
      | "stunned";
    health: number;
    timer: number;
    cooldown: number;
    struck: boolean;
    navigationClock: number;
    goal: THREE.Vector3;
    speed: number;
    steeringClock: number;
    steering: THREE.Vector3;
    animationClock: number;
    boundsClock: number;
    suspended: boolean;
    legs?: [THREE.Object3D, THREE.Object3D];
    gaitClock: number;
    kind: "robot" | "quad" | "eye" | "dino";
    muzzle: THREE.Object3D;
    radius: number;
    maxHealth: number;
    attackDamage: number;
    attackRange: number;
    attackDuration: number;
  };
  const enemies: JungleEnemy[] = [],
    templates: THREE.Group[] = [];
  const spawnGeometry = new THREE.RingGeometry(0.7, 0.82, 24);
  const spawnMaterial = new THREE.MeshBasicMaterial({
    color: 0xe89b4c,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  function animateJungleEnemy(enemy: JungleEnemy, name: string, once = false) {
    if (enemy.action === name) return;
    const action = enemy.actions.get(name) ?? enemy.actions.get("Idle");
    if (!action) return;
    enemy.mixer.stopAllAction();
    enemy.action = name;
    const rate =
      name === "Attack" && enemy.kind !== "dino"
        ? action.getClip().duration / enemy.attackDuration
        : name === "Run" && enemy.kind === "dino"
          ? 2.5
          : 1;
    action
      .reset()
      .setEffectiveWeight(1)
      .setEffectiveTimeScale(rate)
      .setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.play();
  }
  function releaseTemplate(template: THREE.Group) {
    template.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    });
    disposeRoom(template as unknown as THREE.Scene);
  }
  function addEnemy(
    template: THREE.Group,
    clips: THREE.AnimationClip[],
    kind: JungleEnemy["kind"],
    index: number,
  ) {
    const dino = kind === "dino",
      radius = dino ? 0.75 : 0.42,
      maxHealth = dino ? 150 : kind === "quad" ? 125 : kind === "eye" ? 50 : 75;
    const root = new THREE.Group(),
      model = clone(template);
    root.name = `Jungle-${kind}-${index}`;
    root.add(model);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, kind === "eye" ? 1.3 : 0.9, 0.45);
    if (arcadeMode) root.add(muzzle);
    root.visible = false;
    scene.add(root);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = true;
      }
    });
    const body = new CANNON.Body({
      mass: dino ? 40 : 12,
      shape: new CANNON.Sphere(radius),
      fixedRotation: true,
      allowSleep: false,
      linearDamping: 0,
      material: new CANNON.Material({ friction: 0, restitution: 0 }),
    });
    const mixer = new THREE.AnimationMixer(model),
      actions = new Map<string, THREE.AnimationAction>();
    if (dino) {
      const aliases: Array<[string, RegExp]> = [
        ["Run", /^(animation|charge|charging|run|running)$/i],
      ];
      for (const [name, pattern] of aliases) {
        const clip = clips.find(
          (clip) => clip.duration > 0 && pattern.test(clip.name.trim()),
        );
        if (clip) actions.set(name, mixer.clipAction(clip));
      }
    } else {
      for (const clip of clips) actions.set(clip.name, mixer.clipAction(clip));
      if (arcadeMode) {
        const aliases: Array<[string, RegExp]> = [
          ["Idle", /idle|hover/i],
          ["Run", /run|walk|fly/i],
          ["Attack", /attack|shoot/i],
          ["Hit", /hit|hurt/i],
          ["TurnOff", /death|die|shutdown|turn.?off/i],
        ];
        for (const [name, pattern] of aliases) {
          const clip = clips.find((clip) => pattern.test(clip.name));
          if (!actions.has(name) && clip) actions.set(name, mixer.clipAction(clip));
        }
      }
      if (!actions.has("Idle") && actions.has("Walk"))
        actions.set("Idle", actions.get("Walk")!);
      if (!actions.has("Run") && actions.has("Walk"))
        actions.set("Run", actions.get("Walk")!);
    }
    const ring = new THREE.Mesh(spawnGeometry, spawnMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    ring.visible = false;
    ring.raycast = () => {};
    root.add(ring);
    enemies.push({
      root,
      body,
      motor: createGroundMotor(body, radius),
      mixer,
      actions,
      action: "",
      ring,
      kind,
      muzzle,
      radius,
      maxHealth,
      attackDamage: dino ? (arcadeMode ? 24 : 10000) : kind === "quad" ? 18 : 12,
      attackRange: dino ? 1.2 : 1.6,
      attackDuration: dino ? (arcadeMode ? 0.8 : 0) : 0.85,
      phase: "dormant",
      health: maxHealth,
      timer: 0,
      cooldown: 1.5,
      struck: false,
      navigationClock: 0,
      goal: new THREE.Vector3(),
      speed: dino ? (arcadeMode ? 4.2 : 5.2) : 3.2 + index * 0.25,
      steeringClock: 0,
      steering: new THREE.Vector3(),
      animationClock: 0,
      boundsClock: 0,
      suspended: false,
      gaitClock: 0,
      legs:
        dino &&
        model.getObjectByName("Bip001 L Thigh_60") &&
        model.getObjectByName("Bip001 R Thigh_71")
          ? [
              model.getObjectByName("Bip001 L Thigh_60")!,
              model.getObjectByName("Bip001 R Thigh_71")!,
            ]
          : undefined,
    });
    if (dino)
      body.addEventListener(
        "collide",
        (event: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
          const enemy = enemies.find((candidate) => candidate.body === body)!;
          if (
            enemy.phase !== "chasing" ||
            !site.isJungleObstacleBody(event.body) ||
            Math.abs(event.contact.getImpactVelocityAlongNormal()) < 2
          )
            return;
          enemy.phase = "stunned";
          enemy.timer = 10;
          enemy.motor.drive(0, 0, 0);
          site.breakJungleObstacle(event.body, body.position);
          enemy.mixer.stopAllAction();
          enemy.action = "";
        },
      );
  }
  function addRobotTemplate(
    gltf: Awaited<ReturnType<typeof loadModel>>,
    kind: "robot" | "quad" | "eye",
    count: number,
  ) {
      if (disposed) {
        releaseTemplate(gltf.scene);
        return;
      }
      const template = gltf.scene,
        bounds = new THREE.Box3().setFromObject(template),
        size = bounds.getSize(new THREE.Vector3());
      template.scale.multiplyScalar(
        (kind === "eye" ? 1.1 : 1.65) / Math.max(size.x, size.y, size.z, 0.001),
      );
      bounds.setFromObject(template);
      const center = bounds.getCenter(new THREE.Vector3());
      template.position.set(
        template.position.x - center.x,
        template.position.y - bounds.min.y + (kind === "eye" ? 0.85 : 0),
        template.position.z - center.z,
      );
      for (let i = 0; i < count; i++)
        addEnemy(template, gltf.animations, kind, i);
      template.visible = false;
      template.name =
        kind === "robot" ? "JunglePatrolTemplate" : `JunglePatrolTemplate-${kind}`;
      scene.add(template);
      templates.push(template);
  }
  const patrolReady = loadModel("Enemy_Trilobite")
    .then((gltf) => {
      addRobotTemplate(gltf, "robot", arcadeMode ? 1 : 4);
      patrolLoaded = true;
    })
    .catch((error) => {
      if (!disposed) {
        patrolLoadError = true;
        console.error("[Scene 17] Could not load jungle patrols:", error);
        if (arcadeMode) throw error;
      }
    });
  const arcadePatrolReady = arcadeMode
    ? Promise.all([
        loadModel("Enemy_QuadShell").then((asset) => addRobotTemplate(asset, "quad", 1)),
        loadModel("Enemy_EyeDrone").then((asset) => addRobotTemplate(asset, "eye", 1)),
      ]).catch((error) => {
        patrolLoadError = true;
        console.error("[Arcade jungle] Could not prepare the mixed enemy roster:", error);
        throw error;
      })
    : Promise.resolve();
  function loadDinosaurs() {
    if (dinoReady || dinoLoadError) return;
    dinoReady = loadDinosaur()
      .then((gltf) => {
        if (disposed) {
          releaseTemplate(gltf.scene);
          return;
        }
        const template = new THREE.Group();
        template.add(gltf.scene);
        template.updateMatrixWorld(true);
        const head = gltf.scene.getObjectByName("Bip001 Head_12"),
          pelvis = gltf.scene.getObjectByName("Bip001 Pelvis_85");
        if (head && pelvis) {
          const forward = head
            .getWorldPosition(new THREE.Vector3())
            .sub(pelvis.getWorldPosition(new THREE.Vector3()));
          if (Math.hypot(forward.x, forward.z) > 0.001)
            template.rotation.y = -Math.atan2(forward.x, forward.z);
        }
        const bounds = new THREE.Box3().setFromObject(template),
          size = bounds.getSize(new THREE.Vector3());
        template.scale.setScalar(
          Math.min(
            2.6 / Math.max(size.y, 0.001),
            4.8 / Math.max(size.x, size.z, 0.001),
          ),
        );
        bounds.setFromObject(template);
        const anchor = pelvis
          ? pelvis.getWorldPosition(new THREE.Vector3())
          : bounds.getCenter(new THREE.Vector3());
        template.position.set(-anchor.x, -bounds.min.y, -anchor.z);
        for (let i = 0; i < (arcadeMode ? 1 : 2); i++)
          addEnemy(template, gltf.animations, "dino", i);
        template.visible = false;
        template.name = "JungleDinoTemplate";
        scene.add(template);
        templates.push(template);
      })
      .catch((error) => {
        if (!disposed) {
          dinoLoadError = true;
          console.error("[Scene 17] Could not load dinosaur:", error);
          if (arcadeMode) throw error;
        }
      });
  }
  if (arcadeMode) loadDinosaurs();
  function inDinoTerritory(x: number, z: number) {
    return (
      site.distanceToSafePath(x, z) > 7 &&
      Math.hypot(x - RESCUE_SITE.clearing.x, z - RESCUE_SITE.clearing.z) > 28 &&
      Math.hypot(x, z - RESCUE_SITE.doorZ) > 22 &&
      (z < 10 || z > 24)
    );
  }
  function spawnDinosaur(enemy: JungleEnemy) {
    const p = player.body.position;
    const path = JUNGLE_ROUTE[site.nearestPathPoint(p.x, p.z).index];
    const away = new THREE.Vector3(p.x - path.x, 0, p.z - path.z).normalize();
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = (Math.random() - 0.5) * 2.4,
        direction = away
          .clone()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      const x = p.x + direction.x * (8 + Math.random() * 7),
        z = p.z + direction.z * (8 + Math.random() * 7);
      if (
        !inDinoTerritory(x, z) ||
        !site.isWalkable(x, z, enemy.radius + 0.5) ||
        enemies.some(
          (other) =>
            other.phase !== "dormant" &&
            Math.hypot(other.body.position.x - x, other.body.position.z - z) <
              6,
        )
      )
        continue;
      enemy.body.position.set(x, enemy.radius + 0.08, z);
      enemy.body.velocity.set(0, 0, 0);
      enemy.body.aabbNeedsUpdate = true;
      site.activatePhysicsNear(enemy.body.position);
      physicsWorld.addBody(enemy.body);
      enemy.motor.reset();
      enemy.root.position.set(x, 0.08, z);
      enemy.root.rotation.y = Math.atan2(p.x - x, p.z - z);
      enemy.root.visible = true;
      enemy.phase = "chasing";
      enemy.timer = 0;
      enemy.action = "";
      enemy.ring.visible = false;
      animateJungleEnemy(enemy, "Run");
      return true;
    }
    return false;
  }
  function clearSight(from: THREE.Vector3, to: THREE.Vector3) {
    let clear = true;
    physicsWorld.raycastAll(
      new CANNON.Vec3(from.x, from.y, from.z),
      new CANNON.Vec3(to.x, to.y, to.z),
      { checkCollisionResponse: true, skipBackfaces: false },
      (hit) => {
        if (hit.body?.type === CANNON.Body.STATIC) clear = false;
      },
    );
    return clear;
  }
  function spawnPatrol() {
    const available = enemies.filter((enemy) => enemy.phase === "dormant");
    const enemy = available.find((enemy) => enemy.kind === "robot");
    if (!enemy) return false;
    const p = player.body.position;
    for (let attempt = 0; attempt < 24; attempt++) {
      const index = THREE.MathUtils.clamp(
        playerRoute.index +
          (Math.random() < 0.75 ? 1 : -1) *
            (16 + Math.floor(Math.random() * 23)),
        32,
        213,
      );
      const t = index / (JUNGLE_ROUTE.length - 1),
        point = JUNGLE_ROUTE[index].clone(),
        tangent = JUNGLE_PATH.getTangentAt(t);
      point.addScaledVector(
        new THREE.Vector3(tangent.z, 0, -tangent.x),
        (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.random() * 1.2),
      );
      const distance = Math.hypot(point.x - p.x, point.z - p.z);
      if (
        point.z < 28 ||
        distance < 12 ||
        distance > 30 ||
        point.distanceTo(RESCUE_SITE.clearing) < 29 ||
        Math.hypot(point.x, point.z - RESCUE_SITE.doorZ) < 20 ||
        !site.isWalkable(
          point.x,
          point.z,
          Math.max(0.85, enemy.radius + 0.35),
        ) ||
        enemies.some(
          (r) =>
            r.phase !== "dormant" &&
            Math.hypot(
              r.body.position.x - point.x,
              r.body.position.z - point.z,
            ) <
              r.radius + enemy.radius + 1.2,
        )
      )
        continue;
      deployEnemy(enemy, point, JUNGLE_ROUTE[index]);
      return true;
    }
    return false;
  }
  function deployEnemy(enemy: JungleEnemy, point: THREE.Vector3, goal: THREE.Vector3) {
    const p = player.body.position;
    enemy.body.type = CANNON.Body.DYNAMIC;
    enemy.body.updateMassProperties();
    enemy.body.position.set(point.x, enemy.radius + 0.08, point.z);
    enemy.body.velocity.set(0, 0, 0);
    enemy.body.force.set(0, 0, 0);
    site.activatePhysicsNear(enemy.body.position);
    enemy.body.collisionResponse = true;
    enemy.body.aabbNeedsUpdate = true;
    enemy.body.wakeUp();
    enemy.motor.reset();
    physicsWorld.addBody(enemy.body);
    enemy.root.position.set(point.x, 0.08, point.z);
    enemy.root.rotation.set(0, Math.atan2(p.x - point.x, p.z - point.z), 0);
    enemy.root.visible = true;
    enemy.health = enemy.maxHealth;
    enemy.phase = "spawning";
    enemy.timer = 1.1;
    enemy.cooldown = 1.2;
    enemy.navigationClock = 0;
    enemy.goal.copy(goal);
    enemy.steeringClock = 0;
    enemy.steering.set(0, 0, 0);
    enemy.animationClock = 0;
    enemy.boundsClock = 0;
    enemy.suspended = false;
    enemy.action = "";
    animateJungleEnemy(enemy, "Idle");
    enemy.mixer.update(0);
    enemy.ring.visible = true;
  }
  let arcadeSpawnSequence = 0;
  function spawnArcadeEnemy() {
    const kinds: JungleEnemy["kind"][] = ["robot", "quad", "eye", "dino"];
    const available = enemies.filter((enemy) => enemy.phase === "dormant");
    const enemy = available.find(
      (candidate) => candidate.kind === kinds[arcadeSpawnSequence % kinds.length],
    ) ?? available[0];
    if (!enemy) return false;
    const p = player.body.position;
    const inArena = site.waterfall.contains(p);
    for (let attempt = 0; attempt < 12; attempt++) {
      const index = THREE.MathUtils.clamp(
        playerRoute.index + (Math.random() < 0.55 ? 1 : -1) * (12 + Math.floor(Math.random() * 22)),
        0,
        patrolRoute.length - 1,
      );
      const point = patrolRoute[index].clone();
      const angle = Math.random() * Math.PI * 2;
      if (inArena) {
        const radius = 5 + Math.random() * 5;
        point.set(p.x + Math.cos(angle) * radius, 0, p.z + Math.sin(angle) * radius);
      } else {
        point.x += Math.cos(angle) * 3;
        point.z += Math.sin(angle) * 3;
      }
      const distance = Math.hypot(point.x - p.x, point.z - p.z);
      if (
        distance < (inArena ? 5 : 9) ||
        distance > 25 ||
        !onArcadeTrail(point, enemy.radius + 0.3) ||
        (inArena && !site.waterfall.contains(point)) ||
        !site.isWalkable(point.x, point.z, enemy.radius + 0.3) ||
        enemies.some((other) =>
          other.phase !== "dormant" &&
          Math.hypot(other.body.position.x - point.x, other.body.position.z - point.z) < other.radius + enemy.radius + 1,
        )
      ) continue;
      deployEnemy(enemy, point, patrolRoute[index]);
      arcadeSpawnSequence++;
      return true;
    }
    return false;
  }
  function damageJungleEnemy(
    enemy: JungleEnemy,
    amount: number,
    weapon?: DamageWeapon,
  ) {
    if (
      disposed ||
      completed ||
      !player.isEnabled() ||
      player.getHealth() <= 0 ||
      enemy.phase === "dormant" ||
      enemy.phase === "dying" ||
      enemy.suspended ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      (weapon !== "pistol" &&
        weapon !== "crowbar" &&
        weapon !== "bloomstick" &&
        weapon !== "unarmed" &&
        weapon !== "tackle")
    )
      return false;
    if (enemy.kind === "dino" && !arcadeMode) return false;
    enemy.health = Math.max(0, enemy.health - amount);
    enemy.ring.visible = false;
    emitComicEffect(scene, enemy.health === 0 ? "clank" : "hit", {
      source: enemy.root,
      weapon,
    });
    if (!enemy.health) {
      enemy.phase = "dying";
      enemy.body.collisionResponse = false;
      enemy.timer =
        Math.max(1, enemy.actions.get("TurnOff")?.getClip().duration ?? 1.3) +
        0.25;
      enemy.body.type = CANNON.Body.KINEMATIC;
      enemy.body.velocity.set(0, 0, 0);
      enemy.body.force.set(0, 0, 0);
      enemy.body.updateMassProperties();
      animateJungleEnemy(enemy, "TurnOff", true);
      if (enemy.kind === "dino") {
        enemy.mixer.stopAllAction();
        enemy.root.rotation.z = 1.35;
      }
      defeatedPatrols++;
    } else if (enemy.phase !== "stunned") {
      enemy.phase = "hit";
      enemy.timer = 0.3;
      enemy.action = "";
      animateJungleEnemy(enemy, "Hit", true);
    }
    return true;
  }
  function knockDownJungleEnemy(enemy: JungleEnemy) {
    if (
      disposed ||
      enemy.kind === "dino" ||
      enemy.phase === "dormant" ||
      enemy.phase === "dying"
    )
      return false;
    enemy.phase = "stunned";
    enemy.timer = KNOCKDOWN_DURATION;
    enemy.cooldown = Math.max(enemy.cooldown, 1);
    enemy.motor.drive(0, 0, 0);
    enemy.ring.visible = false;
    enemy.action = "";
    animateJungleEnemy(enemy, "Idle");
    return true;
  }
  function retireJungleEnemy(enemy: JungleEnemy) {
    if (enemy.body.world === physicsWorld) physicsWorld.removeBody(enemy.body);
    enemy.body.velocity.set(0, 0, 0);
    enemy.root.visible = false;
    enemy.root.rotation.z = 0;
    enemy.ring.visible = false;
    enemy.phase = "dormant";
    enemy.suspended = false;
    enemy.mixer.stopAllAction();
    enemy.action = "";
  }
  function updatePatrols(dt: number) {
    if (
      disposed ||
      completed ||
      sharkClock >= 0 ||
      miniboss.isCinematic() ||
      (!arcadeMode && site.waterfall.locked) ||
      deathClock > 0 ||
      !player.isEnabled() ||
      player.getHealth() <= 0
    )
      return;
    const p = player.body.position;
    const nearLanding =
      Math.hypot(p.x - RESCUE_SITE.clearing.x, p.z - RESCUE_SITE.clearing.z) <
      27;
    const nearFacility = Math.hypot(p.x, p.z - RESCUE_SITE.doorZ) < 21;
    const inTerritory = !arcadeMode && inDinoTerritory(p.x, p.z);
    const attackBudget = arcadeMode
      ? arcadeAttackLimit - (miniboss.getStatus().phase === "fight" ? 1 : 0)
      : Infinity;
    const attackSlots = arcadeMode
      ? new Set(enemies.filter((enemy) =>
          !enemy.suspended && enemy.phase !== "dormant" && enemy.phase !== "dying",
        ).sort((a, b) =>
          Math.hypot(a.body.position.x - p.x, a.body.position.z - p.z) -
          Math.hypot(b.body.position.x - p.x, b.body.position.z - p.z),
        ).slice(0, attackBudget))
      : null;
    if (arcadeMode) {
      spawnClock -= dt;
      const active = enemies.filter((enemy) => enemy.phase !== "dormant").length;
      if (spawnClock <= 0 && active < arcadeEnemyLimit) {
        spawnClock = spawnArcadeEnemy() ? 2.5 : 1;
      }
    } else if (inTerritory) {
      loadDinosaurs();
      dinoSpawnClock -= dt;
      const active = enemies.filter(
        (enemy) => enemy.kind === "dino" && enemy.phase !== "dormant",
      ).length;
      if (active < 2 && dinoSpawnClock <= 0) {
        const dormant = enemies.find(
          (enemy) => enemy.kind === "dino" && enemy.phase === "dormant",
        );
        if (dormant && spawnDinosaur(dormant)) dinoSpawnClock = 5;
      }
    }
    if (
      !arcadeMode &&
      patrolLoaded &&
      !nearLanding &&
      !nearFacility &&
      playerRoute.distance < 12
    ) {
      spawnClock -= dt;
      const active = enemies.filter(
        (r) => r.kind === "robot" && r.phase !== "dormant",
      ).length;
      if (spawnClock <= 0 && active < 3) {
        const spawned = spawnPatrol();
        if (spawned && active === 0 && Math.random() < 0.3) spawnPatrol();
        spawnClock = spawned ? 7 + Math.random() * 7 : 1;
      }
    }
    for (const enemy of enemies) {
      if (enemy.phase === "dormant") continue;
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      const distance = Math.hypot(
        p.x - enemy.body.position.x,
        p.z - enemy.body.position.z,
      );
      if (arcadeMode && enemy.phase !== "dying") {
        if (distance > 38) {
          if (!enemy.suspended) {
            if (enemy.body.world === physicsWorld) physicsWorld.removeBody(enemy.body);
            enemy.body.velocity.set(0, 0, 0);
            enemy.root.visible = false;
            enemy.suspended = true;
          }
          continue;
        }
        if (enemy.suspended) {
          enemy.suspended = false;
          enemy.root.visible = true;
          site.activatePhysicsNear(enemy.body.position);
          physicsWorld.addBody(enemy.body);
          enemy.body.wakeUp();
          enemy.motor.reset();
        }
      }
      const canAttack = !attackSlots || attackSlots.has(enemy);
      if (!canAttack && enemy.phase === "attacking") {
        enemy.phase = "chasing";
        animateJungleEnemy(enemy, "Run");
      }
      if (enemy.phase === "dying") {
        enemy.body.velocity.set(0, 0, 0);
        enemy.timer -= dt;
        if (enemy.timer <= 0) retireJungleEnemy(enemy);
        continue;
      }
      if (enemy.phase === "stunned") {
        enemy.timer = Math.max(0, enemy.timer - dt);
        enemy.motor.drive(0, 0, 0);
        if (enemy.kind !== "dino")
          enemy.root.rotation.z = -knockdownTilt(enemy.timer);
        if (enemy.timer <= 0) {
          enemy.root.rotation.z = 0;
          enemy.phase = "chasing";
          animateJungleEnemy(enemy, "Run");
        }
        continue;
      }
      if (!arcadeMode && enemy.kind === "dino" && enemy.phase !== "spawning" && enemy.phase !== "hit") {
        if (distance > 48) {
          retireJungleEnemy(enemy);
          continue;
        }
        if (!arcadeMode && (!inTerritory || site.distanceToSafePath(p.x, p.z) <= 5)) {
          enemy.motor.drive(0, 0, 0);
          enemy.mixer.stopAllAction();
          enemy.action = "";
          continue;
        }
        if (
          distance < enemy.radius + player.radius + 0.35 &&
          Math.abs(p.y - enemy.body.position.y) < 1.4
        ) {
          if (!arcadeMode || enemy.cooldown <= 0) {
            player.takeDamage(enemy.attackDamage);
            enemy.cooldown = 1.5;
          }
          enemy.motor.drive(0, 0, 0);
          continue;
        }
        enemy.steering
          .set(p.x - enemy.body.position.x, 0, p.z - enemy.body.position.z)
          .normalize();
        enemy.motor.drive(enemy.steering.x, enemy.steering.z, enemy.speed);
        enemy.root.rotation.y = Math.atan2(enemy.steering.x, enemy.steering.z);
        animateJungleEnemy(enemy, "Run");
        continue;
      }
      if (!arcadeMode && distance > 62) {
        retireJungleEnemy(enemy);
        continue;
      }
      if (enemy.phase === "spawning" || enemy.phase === "hit") {
        enemy.timer -= dt;
        enemy.motor.drive(0, 0, 0);
        enemy.ring.scale.setScalar(
          ((1 + Math.sin(enemy.timer * 14) * 0.12) * enemy.radius) / 0.42,
        );
        if (enemy.timer <= 0) {
          enemy.phase = "chasing";
          enemy.ring.visible = false;
          animateJungleEnemy(enemy, "Run");
        }
        continue;
      }
      if (!arcadeMode && (nearLanding || p.z < RESCUE_SITE.doorZ)) {
        enemy.motor.drive(0, 0, 0);
        enemy.phase = "chasing";
        animateJungleEnemy(enemy, "Idle");
        continue;
      }
      const eye = new THREE.Vector3(
        enemy.body.position.x,
        enemy.body.position.y + 0.35,
        enemy.body.position.z,
      );
      const target = new THREE.Vector3(p.x, p.y + 0.35, p.z);
      if (enemy.kind === "eye" && distance < 18 && clearSight(eye, target)) {
        enemy.root.rotation.y = Math.atan2(p.x - eye.x, p.z - eye.z);
        if (canAttack && enemy.cooldown <= 0) {
          fire({ muzzle: enemy.muzzle, aim: target }, 26);
          enemy.cooldown = 2.2;
        }
        if (distance < 9) {
          enemy.motor.drive(0, 0, 0);
          animateJungleEnemy(enemy, "Idle");
          continue;
        }
      }
      if (enemy.phase === "attacking") {
        enemy.motor.drive(0, 0, 0);
        enemy.timer -= dt;
        if (!enemy.struck && enemy.timer <= enemy.attackDuration * 0.4) {
          enemy.struck = true;
          if (
            distance < enemy.attackRange + 0.3 &&
            Math.abs(p.y - enemy.body.position.y) < 1.4 &&
            clearSight(eye, target)
          )
            player.takeDamage(enemy.attackDamage);
        }
        if (enemy.timer <= 0) {
          enemy.phase = "chasing";
          animateJungleEnemy(enemy, "Run");
        }
        continue;
      }
      if (
        canAttack &&
        distance < enemy.attackRange &&
        enemy.cooldown <= 0 &&
        clearSight(eye, target)
      ) {
        enemy.phase = "attacking";
        enemy.timer = enemy.attackDuration;
        enemy.struck = false;
        enemy.cooldown = enemy.attackDuration + 1 + Math.random();
        enemy.root.rotation.y = Math.atan2(p.x - eye.x, p.z - eye.z);
        animateJungleEnemy(enemy, "Attack", true);
        enemy.motor.drive(0, 0, 0);
        continue;
      }
      enemy.navigationClock -= dt;
      if (enemy.navigationClock <= 0) {
        enemy.navigationClock = 0.35;
        enemy.steeringClock = 0;
        if (distance < 12 && clearSight(eye, target))
          enemy.goal.set(p.x, 0, p.z);
        else {
          const nearest = nearestPatrolPoint(eye.x, eye.z),
            advance =
              nearest.distance > 2.1
                ? 0
                : Math.sign(playerRoute.index - nearest.index) * 3;
          enemy.goal.copy(
            patrolRoute[
              THREE.MathUtils.clamp(
                nearest.index + advance,
                0,
                patrolRoute.length - 1,
              )
            ],
          );
        }
      }
      const toward = enemy.steering,
        remaining = Math.hypot(enemy.goal.x - eye.x, enemy.goal.z - eye.z);
      enemy.steeringClock -= dt;
      if (enemy.steeringClock <= 0) {
        // Avoidance does not need five world raycasts on every 120 Hz physics tick.
        enemy.steeringClock = 0.12;
        toward.set(enemy.goal.x - eye.x, 0, enemy.goal.z - eye.z).normalize();
        if (!clearSight(eye, eye.clone().addScaledVector(toward, 1.5))) {
          let found = false;
          for (const angle of [0.8, -0.8, 1.5, -1.5]) {
            const detour = toward
              .clone()
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            if (clearSight(eye, eye.clone().addScaledVector(detour, 1.5))) {
              toward.copy(detour);
              found = true;
              break;
            }
          }
          if (!found) toward.set(0, 0, 0);
        }
      }
      enemy.motor.drive(
        toward.x,
        toward.z,
        distance < 1.1 ? 0 : Math.min(enemy.speed, remaining / dt),
      );
      if (toward.lengthSq() > 0) {
        const yaw = Math.atan2(toward.x, toward.z),
          delta = Math.atan2(
            Math.sin(yaw - enemy.root.rotation.y),
            Math.cos(yaw - enemy.root.rotation.y),
          );
        enemy.root.rotation.y += delta * (1 - Math.exp(-10 * dt));
      }
      animateJungleEnemy(enemy, "Run");
    }
  }
  const boltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 1.35, 8);
  const boltMaterial = new THREE.MeshBasicMaterial({ color: 0xff5643 });
  const beams = new THREE.Group();
  beams.name = "FacilityDefenseLasers";
  scene.add(beams);
  const bolts = Array.from({ length: 32 }, () => {
    const mesh = new THREE.Mesh(boltGeometry, boltMaterial);
    mesh.visible = false;
    beams.add(mesh);
    return {
      mesh,
      velocity: new THREE.Vector3(),
      life: 0,
      parried: false,
      returned: false,
      owner: "boss" as "boss" | "player",
    };
  });
  const turrets = site.turrets.map((turret, index) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4234,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 1, 6),
      material,
    );
    mesh.visible = false;
    scene.add(mesh);
    return {
      ...turret,
      telegraph: mesh,
      aim: new THREE.Vector3(),
      health: 100,
      clock: 1.2 + index * 0.65,
      delay: 0.9 + index * 0.65,
      charging: false,
    };
  });
  const up = new THREE.Vector3(0, 1, 0),
    origin = new THREE.Vector3(),
    direction = new THREE.Vector3();
  const playerBounds = new THREE.Box3(),
    ray = new THREE.Ray(),
    intersection = new THREE.Vector3();
  const rayFrom = new CANNON.Vec3(),
    rayTo = new CANNON.Vec3();

  function stopDefense() {
    for (const sentry of sentries) {
      sentry.body.velocity.set(0, 0, 0);
      sentry.charge = -1;
      sentry.actor.charge(0);
      sentry.actor.walk(false);
    }
    for (const bolt of bolts) {
      bolt.life = 0;
      bolt.mesh.visible = false;
    }
    for (const turret of turrets) {
      turret.charging = false;
      turret.telegraph.visible = false;
      turret.muzzle.scale.setScalar(1);
    }
    for (const enemy of enemies) {
      enemy.body.velocity.set(0, 0, 0);
      enemy.ring.visible = false;
    }
  }
  function freezePlayer() {
    player.disable();
    player.body.velocity.set(0, 0, 0);
    player.body.type = CANNON.Body.KINEMATIC;
    player.body.updateMassProperties();
  }
  function fire(
    turret: { muzzle: THREE.Object3D; aim: THREE.Vector3 },
    speed = 38,
  ) {
    const bolt = bolts.find((item) => item.life <= 0);
    if (!bolt) return;
    turret.muzzle.getWorldPosition(origin);
    emitComicEffect(scene, "pew", {
      source: turret.muzzle.parent ?? turret.muzzle,
      position: origin,
      size: 1.5,
    });
    direction.copy(turret.aim).sub(origin).normalize();
    bolt.mesh.position.copy(origin);
    bolt.mesh.quaternion.setFromUnitVectors(up, direction);
    bolt.velocity.copy(direction).multiplyScalar(speed);
    bolt.life = 3;
    bolt.mesh.visible = true;
    bolt.parried = false;
    bolt.returned = false;
    bolt.owner = "boss";
    site.activatePhysicsNear(origin);
  }
  function damageSentry(
    sentry: (typeof sentries)[number],
    amount: number,
    weapon?: DamageWeapon,
  ) {
    if (
      disposed ||
      completed ||
      deathClock > 0 ||
      !player.isEnabled() ||
      player.getHealth() <= 0 ||
      !sentry.active ||
      (weapon !== "pistol" &&
        weapon !== "crowbar" &&
        weapon !== "bloomstick" &&
        weapon !== "unarmed" &&
        weapon !== "tackle") ||
      !sentry.actor.damage(amount, weapon)
    )
      return false;
    if (sentry.actor.health === 0) {
      sentry.charge = -1;
      sentry.body.collisionResponse = false;
      sentry.body.type = CANNON.Body.KINEMATIC;
      sentry.body.velocity.set(0, 0, 0);
      sentry.body.force.set(0, 0, 0);
      sentry.body.updateMassProperties();
      defeatedPatrols++;
    }
    return true;
  }
  function damageTurret(
    turret: (typeof turrets)[number],
    amount: number,
    weapon?: DamageWeapon,
  ) {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new RangeError(
        "Facility sentinel damage must be positive and finite",
      );
    if (
      disposed ||
      completed ||
      deathClock > 0 ||
      turret.health <= 0 ||
      !player.isEnabled() ||
      player.getHealth() <= 0 ||
      (weapon !== "pistol" && weapon !== "bloomstick")
    )
      return false;
    turret.health = Math.max(0, turret.health - amount);
    emitComicEffect(scene, turret.health === 0 ? "boom" : "hit", {
      source: turret.root,
      weapon,
      size: 2,
    });
    if (!turret.health) {
      turret.charging = false;
      turret.telegraph.visible = false;
      turret.root.visible = false;
    }
    return true;
  }
  function damageTargets(): DamageTarget[] {
    return [
      ...enemies
        .filter(
          (enemy) =>
            (arcadeMode || enemy.kind !== "dino") &&
            enemy.phase !== "dormant" &&
            enemy.phase !== "dying" &&
            !enemy.suspended,
        )
        .map((enemy): DamageTarget => ({
          root: enemy.root,
          body: enemy.body,
          damage: (amount, weapon) => damageJungleEnemy(enemy, amount, weapon),
          knockDown: () => knockDownJungleEnemy(enemy),
        })),
      ...sentries
        .filter((sentry) => sentry.active && sentry.actor.health > 0)
        .map((sentry): DamageTarget => ({
          root: sentry.actor.root,
          body: sentry.body,
          damage: (amount, weapon) => damageSentry(sentry, amount, weapon),
          knockDown: () => sentry.actor.knockDown(),
        })),
      ...turrets
        .filter((turret) => !arcadeMode && turret.health > 0)
        .map((turret): DamageTarget => ({
          root: turret.root,
          damage: (amount, weapon) => damageTurret(turret, amount, weapon),
        })),
      ...miniboss.getDamageTargets(),
      ...(brendanBody ? [{ ...site.getBrendanTarget(), body: brendanBody }] : []),
    ];
  }
  function updateSentries(dt: number) {
    if (
      disposed ||
      completed ||
      site.waterfall.locked ||
      deathClock > 0 ||
      !player.isEnabled() ||
      player.getHealth() <= 0
    )
      return;
    const p = new THREE.Vector3().copy(player.body.position),
      target = p.clone().add(new THREE.Vector3(0, 0.8, 0));
    for (const [index, sentry] of sentries.entries()) {
      const { actor, body, home } = sentry;
      if (sentry.spent || !actor.loaded) continue;
      if (!sentry.active) {
        if (
          arrivalClock < 2 ||
          p.z > RESCUE_SITE.riverZ - RESCUE_SITE.riverHalfWidth ||
          home.distanceTo(p) > 34
        )
          continue;
        let spawnPoint: THREE.Vector3 | null = null;
        for (const dz of [-2.5, 2.5, 0, -4, 4]) {
          const candidate = home.clone().add(new THREE.Vector3(0, 0, dz));
          if (
            candidate.distanceTo(p) > 8 &&
            site.isWalkable(candidate.x, candidate.z, 1.2) &&
            candidate.z < 8
          ) {
            spawnPoint = candidate;
            break;
          }
        }
        if (!spawnPoint) continue;
        body.position.set(spawnPoint.x, 0.87, spawnPoint.z);
        body.velocity.set(0, 0, 0);
        body.aabbNeedsUpdate = true;
        site.activatePhysicsNear(body.position);
        physicsWorld.addBody(body);
        sentry.motor.reset();
        sentry.active = true;
        actor.root.position.set(spawnPoint.x, 0.02, spawnPoint.z);
        actor.root.visible = true;
        actor.aimAt(target);
      }
      if (actor.health <= 0) continue;
      if (actor.knockedDown) {
        sentry.motor.drive(0, 0, 0);
        sentry.charge = -1;
        sentry.cooldown = Math.max(sentry.cooldown, 1);
        continue;
      }
      const from = new THREE.Vector3(
        body.position.x,
        body.position.y + 1.35,
        body.position.z,
      );
      const delta = p.clone().sub(new THREE.Vector3().copy(body.position));
      delta.y = 0;
      const distance = delta.length();
      delta.normalize();
      sentry.cooldown -= dt;
      if (distance > 48 || p.z < RESCUE_SITE.doorZ) {
        sentry.motor.drive(0, 0, 0);
        sentry.charge = -1;
        actor.charge(0);
        actor.walk(false);
        continue;
      }
      if (sentry.charge >= 0) {
        if (distance < 9 || distance > 32) {
          sentry.charge = -1;
          sentry.cooldown = 1;
          actor.charge(0);
        } else {
          sentry.motor.drive(0, 0, 0);
          actor.walk(false);
          sentry.charge -= dt;
          if (sentry.charge > 0.4)
            sentry.aim
              .copy(target)
              .addScaledVector(
                new THREE.Vector3().copy(player.body.velocity),
                0.12,
              );
          actor.aimAt(sentry.aim);
          actor.charge(1 - Math.max(0, sentry.charge) / 1.15);
          if (sentry.charge <= 0) {
            actor.root.updateMatrixWorld(true);
            if (clearSight(from, sentry.aim)) {
              fire({ muzzle: actor.muzzle, aim: sentry.aim }, 26);
              actor.fire();
            } else actor.charge(0);
            sentry.charge = -1;
            sentry.cooldown = 2.6 + index * 0.4;
          }
          continue;
        }
      }
      if (
        distance >= 12 &&
        distance <= 29 &&
        sentry.cooldown <= 0 &&
        clearSight(from, target)
      ) {
        sentry.charge = 1.15;
        sentry.aim.copy(target);
        actor.walk(false);
        sentry.motor.drive(0, 0, 0);
        continue;
      }
      sentry.steeringClock -= dt;
      if (sentry.steeringClock <= 0) {
        sentry.steeringClock = 0.16;
        const desired =
          distance < 13
            ? delta.clone().negate()
            : distance > 20
              ? delta.clone()
              : new THREE.Vector3(delta.z, 0, -delta.x).multiplyScalar(
                  Math.sin(elapsed * 0.45 + index * 2) >= 0 ? 1 : -1,
                );
        for (const other of sentries)
          if (other !== sentry && other.active && other.actor.health > 0) {
            const away = new THREE.Vector3()
              .copy(body.position)
              .sub(new THREE.Vector3().copy(other.body.position));
            away.y = 0;
            if (away.lengthSq() < 16)
              desired.addScaledVector(away.normalize(), 1.2);
          }
        desired.normalize();
        sentry.steering.set(0, 0, 0);
        for (const angle of [0, 0.75, -0.75, 1.45, -1.45]) {
          const option = desired.clone().applyAxisAngle(up, angle),
            probe = new THREE.Vector3()
              .copy(body.position)
              .addScaledVector(option, 2);
          if (
            probe.z > 8 ||
            Math.hypot(probe.x - home.x, probe.z - home.z) > 25 ||
            !site.isWalkable(probe.x, probe.z, 1.15)
          )
            continue;
          const eye = new THREE.Vector3(body.position.x, 0.7, body.position.z);
          probe.y = 0.7;
          if (clearSight(eye, probe)) {
            sentry.steering.copy(option);
            break;
          }
        }
      }
      const speed = distance < 13 ? 3.7 : distance > 20 ? 2.3 : 1;
      sentry.motor.drive(sentry.steering.x, sentry.steering.z, speed);
      actor.aimAt(target);
      actor.walk(sentry.steering.lengthSq() > 0);
    }
  }
  function updateDefense(dt: number) {
    if (
      disposed ||
      completed ||
      sharkClock >= 0 ||
      (!arcadeMode && site.waterfall.locked) ||
      deathClock > 0 ||
      !player.isEnabled() ||
      player.getHealth() <= 0
    )
      return;
    elapsed += dt;
    const p = player.body.position,
      distance = Math.hypot(p.x, p.z - RESCUE_SITE.doorZ);
    if (!alerted && distance < 34 && p.z > RESCUE_SITE.doorZ) alerted = true;
    const exposed = !arcadeMode && alerted && distance < 65 && p.z > RESCUE_SITE.doorZ + 0.1;
    for (const turret of turrets) {
      if (turret.health <= 0) continue;
      if (!exposed) {
        turret.charging = false;
        turret.clock = turret.delay;
        turret.telegraph.visible = false;
        turret.muzzle.scale.setScalar(1);
        continue;
      }
      turret.clock -= dt;
      if (!turret.charging && turret.clock <= 0) {
        turret.charging = true;
        turret.clock = 0.85;
      }
      if (!turret.charging || turret.clock > 0.3) {
        turret.aim.set(
          p.x + player.body.velocity.x * 0.18,
          p.y + 0.7,
          p.z + player.body.velocity.z * 0.18,
        );
      }
      turret.root.lookAt(turret.aim);
      turret.root.updateMatrixWorld(true);
      turret.muzzle.getWorldPosition(origin);
      direction.copy(turret.aim).sub(origin);
      turret.telegraph.visible = turret.charging;
      if (turret.charging) {
        turret.telegraph.position.copy(origin).addScaledVector(direction, 0.5);
        turret.telegraph.scale.y = direction.length();
        turret.telegraph.quaternion.setFromUnitVectors(
          up,
          direction.normalize(),
        );
        turret.telegraph.material.opacity = turret.clock < 0.3 ? 0.65 : 0.22;
        turret.muzzle.scale.setScalar(1.2 + Math.sin(elapsed * 40) * 0.3);
        if (turret.clock <= 0) {
          fire(turret);
          turret.charging = false;
          turret.clock = 0.65;
          turret.telegraph.visible = false;
        }
      } else turret.muzzle.scale.setScalar(1);
    }
    // The walking controller uses a foot sphere; lasers also hit the visible torso.
    const height = player.getState().crouching ? 0.95 : 1.65;
    playerBounds.min.set(p.x - 0.32, p.y - player.radius, p.z - 0.32);
    playerBounds.max.set(p.x + 0.32, p.y - player.radius + height, p.z + 0.32);
    const targetBounds = new THREE.Box3();
    for (const bolt of bolts) {
      if (bolt.life <= 0) continue;
      if (bolt.parried && !bolt.returned) {
        bolt.returned = true;
        bolt.life = Math.max(bolt.life, 3);
      }
      const from = bolt.mesh.position,
        to = from.clone().addScaledVector(bolt.velocity, dt),
        travel = from.distanceTo(to);
      ray.set(from, direction.copy(bolt.velocity).normalize());
      // Keep the cylinder aligned with its (possibly deflected) travel direction.
      if (bolt.parried) bolt.mesh.quaternion.setFromUnitVectors(up, direction);
      let obstruction = Infinity;
      const targets =
        bolt.parried && bolt.owner === "player" ? damageTargets() : [];
      rayFrom.set(from.x, from.y, from.z);
      rayTo.set(to.x, to.y, to.z);
      physicsWorld.raycastAll(
        rayFrom,
        rayTo,
        { skipBackfaces: false, checkCollisionResponse: true },
        (hit) => {
          if (
            hit.body !== player.body &&
            hit.body?.collisionResponse &&
            !targets.some((target) => target.body === hit.body)
          )
            obstruction = Math.min(obstruction, hit.distance);
        },
      );
      bolt.life -= dt;
      if (bolt.parried && bolt.owner === "player") {
        let distance = Infinity,
          hit: DamageTarget | null = null;
        for (const target of targets) {
          targetBounds.setFromObject(target.root);
          const point = ray.intersectBox(targetBounds, intersection);
          const contact = targetBounds.containsPoint(from)
            ? 0
            : point
              ? from.distanceTo(point)
              : Infinity;
          if (contact <= travel && contact < distance) {
            distance = contact;
            hit = target;
          }
        }
        if (hit && distance < obstruction) {
          hit.damage(PARRY_DAMAGE, "bloomstick");
          bolt.life = 0;
        } else if (obstruction !== Infinity) bolt.life = 0;
      } else {
        const contact = ray.intersectBox(playerBounds, intersection);
        const playerDistance = playerBounds.containsPoint(from)
          ? 0
          : contact
            ? from.distanceTo(contact)
            : Infinity;
        if (playerDistance <= travel && playerDistance < obstruction) {
          player.takeDamage(12);
          bolt.life = 0;
        } else if (obstruction !== Infinity) bolt.life = 0;
      }
      if (bolt.life <= 0) bolt.mesh.visible = false;
      else bolt.mesh.position.copy(to);
    }
  }
  const physicsFocus: Array<{ x: number; y: number; z: number }> = [];
  function constrainArcadePlayer() {
    if (!arcadeMode || completed || miniboss.isCinematic()) return;
    const p = player.body.position, velocity = player.body.velocity;
    const beforeX = p.x, beforeY = p.y, beforeZ = p.z;
    const margin = player.radius + 0.2;
    if (p.x < -84) {
      p.x = Math.max(-106 + margin, p.x);
      p.z = THREE.MathUtils.clamp(p.z, 9 + margin, 25 - margin);
      if (p.x !== beforeX && velocity.x < 0) velocity.x = 0;
      if (p.z !== beforeZ && velocity.z * (beforeZ - p.z) > 0) velocity.z = 0;
    } else {
      const closest = nearestTrail(p);
      const distance = Math.sqrt(closest.squared);
      const radius = trailHalfWidth - margin;
      if (distance > radius) {
        const nx = (p.x - closest.x) / distance;
        const nz = (p.z - closest.z) / distance;
        p.x = closest.x + nx * radius;
        p.z = closest.z + nz * radius;
        const outward = velocity.x * nx + velocity.z * nz;
        if (outward > 0) {
          velocity.x -= nx * outward;
          velocity.z -= nz * outward;
        }
      }
      const first = arcadeTrail[0], next = arcadeTrail[1];
      const length = first.distanceTo(next);
      const dx = (next.x - first.x) / length, dz = (next.z - first.z) / length;
      const behind = (p.x - first.x) * dx + (p.z - first.z) * dz;
      const rearLimit = -(0.6 - player.radius - 0.175);
      if (behind < rearLimit) {
        p.x -= dx * (behind - rearLimit);
        p.z -= dz * (behind - rearLimit);
        const backward = velocity.x * dx + velocity.z * dz;
        if (backward < 0) {
          velocity.x -= dx * backward;
          velocity.z -= dz * backward;
        }
      }
    }
    if (p.y < player.radius + 0.02) {
      p.y = player.radius + 0.02;
      velocity.y = Math.max(0, velocity.y);
    }
    if (p.x !== beforeX || p.y !== beforeY || p.z !== beforeZ) {
      player.body.aabbNeedsUpdate = true;
      physicsWorld.broadphase.dirty = true;
    }
  }
  function syncNearbyPhysics() {
    physicsFocus.length = 0;
    physicsFocus.push(player.body.position);
    for (const enemy of enemies)
      if (enemy.phase !== "dormant" && !enemy.suspended) physicsFocus.push(enemy.body.position);
    for (const sentry of sentries)
      if (sentry.active) physicsFocus.push(sentry.body.position);
    for (const bolt of bolts)
      if (bolt.life > 0) physicsFocus.push(bolt.mesh.position);
    if (miniboss.body.world === physicsWorld)
      physicsFocus.push(miniboss.body.position);
    site.updateActivePhysics(physicsFocus);
  }
  const unregister = registerPhysicsActor(physicsWorld, {
    body: player.body,
    beforePhysicsStep(dt: number) {
      updateSentries(dt);
      updateDefense(dt);
      updatePatrols(dt);
      miniboss.beforePhysicsStep(dt);
    },
    afterPhysicsStep() {
      miniboss.afterPhysicsStep();
      constrainArcadePlayer();
      for (const sentry of sentries)
        if (sentry.active) {
          if (sentry.actor.health > 0) sentry.motor.readSupport();
          sentry.actor.root.position.set(
            sentry.body.position.x,
            sentry.body.position.y - 0.85,
            sentry.body.position.z,
          );
        }
      for (const enemy of enemies)
        if (enemy.phase !== "dormant" && !enemy.suspended) {
          if (enemy.phase !== "dying") enemy.motor.readSupport();
          enemy.root.position.set(
            enemy.body.position.x,
            enemy.body.position.y - enemy.radius,
            enemy.body.position.z,
          );
        }
    },
  });
  function updateHud() {
    if (completed || deathClock > 0 || sharkClock >= 0)
      return;
    const nearBoy =
      !arcadeMode &&
      arrivalClock < 7 &&
      Math.hypot(
        player.body.position.x - boy.position.x,
        player.body.position.z - boy.position.z,
      ) < 12;
    caption?.classList.toggle("hidden", !nearBoy);
    if (nearBoy && caption)
      caption.textContent =
        "Brendan: Go ahead, Brondon. I need some time to recover from what Donus did to me.";
    if (status)
      status.textContent =
        patrolLoadError || dinoLoadError || sharkLoadError
          ? "JUNGLE ASSETS COULD NOT LOAD / RESTART THIS CHECKPOINT"
          : site.waterfall.locked
            ? "WATERFALL WARDEN / DEFEAT IT TO UNSEAL THE ARENA"
            : miniboss.getStatus().achievementUnlocked
              ? "SECRET FOUND / BEHIND THE FALLS"
              : arcadeMode
                ? "ARCADE / FOLLOW THE STONE TRAIL TO THE WATERFALL\nBridge sealed. Mixed enemy waves continue until the Warden falls."
                : "FACILITY APPROACH / FOLLOW THE STONE PATH\nSpider bots patrol beyond the bridge.";
  }
  function captureArrival(): RescueArrival {
    const reward = miniboss.getStatus();
    return {
      ...entryState,
      waterfallDefeated: reward.defeated,
      waterfallAchievementUnlocked: reward.achievementUnlocked,
      bossImmunityCollected: false,
      pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }),
    };
  }
  function finishArcadeRun() {
    if (!arcadeMode || completed) return;
    completed = true;
    stopDefense();
    freezePlayer();
    status?.classList.add("hidden");
    prompt?.classList.add("hidden");
    caption?.classList.add("hidden");
    onArcadeComplete?.();
  }
  function finish(state: PlayerTransitionState) {
    const arrival = {
      ...captureArrival(),
      pilotState: state,
      cameraPosition: undefined,
      cameraQuaternion: undefined,
      cameraFov: undefined,
    };
    completed = true;
    stopDefense();
    freezePlayer();
    status?.classList.add("hidden");
    prompt?.classList.add("hidden");
    caption?.classList.add("hidden");
    onFinished?.(arrival);
  }
  if (!arcadeMode) door.setTrigger(finish);
  function entryViewCamera() {
    if (sharkClock >= 0) return sharkViewCamera();
    return miniboss.applyCinematicCamera();
  }
  function updateSharks(dt: number) {
    for (const shark of sharks) {
      const t = elapsed * 0.55 + shark.phase;
      shark.root.position.set(
        shark.homeX + Math.sin(t) * 5,
        shark.baseY + Math.sin(t * 1.8) * 0.04,
        shark.root.position.z,
      );
      shark.root.rotation.y = Math.cos(t) > 0 ? Math.PI / 2 : -Math.PI / 2;
      shark.mixer.update(dt);
    }
  }
  function beginSharkSwarm() {
    sharkClock = 0;
    riverEntry.copy(player.body.position);
    riverEntry.z = THREE.MathUtils.clamp(
      riverEntry.z,
      RESCUE_SITE.riverZ - RESCUE_SITE.riverHalfWidth + 3.3,
      RESCUE_SITE.riverZ + RESCUE_SITE.riverHalfWidth - 3.3,
    );
    const bridgeDistance = riverEntry.x - RESCUE_SITE.bridge.x;
    if (Math.abs(bridgeDistance) < 4.5)
      riverEntry.x =
        RESCUE_SITE.bridge.x + (Math.sign(bridgeDistance) || 1) * 4.5;
    riverCamera.copy(camera.position);
    riverRotation.copy(camera.quaternion);
    const closest = [...sharks]
      .sort(
        (a, b) =>
          a.root.position.distanceToSquared(riverEntry) -
          b.root.position.distanceToSquared(riverEntry),
      )
      .slice(0, 4);
    sharks.forEach((shark) => {
      shark.start.copy(shark.root.position);
      shark.attackIndex = closest.indexOf(shark);
    });
    stopDefense();
    freezePlayer();
    player.body.collisionResponse = false;
    status?.classList.add("hidden");
    prompt?.classList.add("hidden");
    if (caption) {
      caption.textContent = "THE SHARKS ARE CLOSING IN";
      caption.classList.remove("hidden");
    }
    updateSharkSwarm(0);
  }
  function sharkViewCamera() {
    if (sharkClock < 0) return false;
    const progress = THREE.MathUtils.smootherstep(sharkClock, 0, 1.4);
    const focus = new THREE.Vector3()
      .copy(player.body.position)
      .add(new THREE.Vector3(0, 0.85, 0));
    const angle = sharkClock * 0.12;
    const view = new THREE.Vector3(
      focus.x + Math.sin(angle) * 5.8,
      RESCUE_SITE.riverY + 4.2,
      focus.z + Math.cos(angle) * 5.8,
    );
    camera.position.lerpVectors(riverCamera, view, progress);
    const target = camera.clone();
    target.position.copy(camera.position);
    target.lookAt(focus);
    camera.quaternion.slerpQuaternions(
      riverRotation,
      target.quaternion,
      progress,
    );
    camera.updateMatrixWorld(true);
    return true;
  }
  function updateSharkSwarm(dt: number) {
    sharkClock += dt;
    const afloat = THREE.MathUtils.smootherstep(sharkClock, 0, 0.65);
    const sink = THREE.MathUtils.smoothstep(
      sharkClock,
      sharkDeathAt + 0.4,
      sharkDeathAt + 2.5,
    );
    const y =
      THREE.MathUtils.lerp(riverEntry.y, RESCUE_SITE.riverY - 0.65, afloat) -
      sink * 1.4;
    player.setPosition(riverEntry.x, y, riverEntry.z);
    for (const shark of sharks) {
      if (shark.attackIndex < 0) {
        shark.mixer.update(dt);
        continue;
      }
      const index = shark.attackIndex,
        approach = THREE.MathUtils.smootherstep(
          sharkClock,
          0.15 + index * 0.2,
          3 + index * 0.25,
        );
      const angle =
        (index / 4) * Math.PI * 2 + Math.max(0, sharkClock - 2.2) * 0.45;
      const radius = 1.15 + (index % 2) * 0.5;
      const target = new THREE.Vector3(
        riverEntry.x + Math.cos(angle) * radius,
        shark.baseY,
        THREE.MathUtils.clamp(
          riverEntry.z + Math.sin(angle) * radius,
          RESCUE_SITE.riverZ - RESCUE_SITE.riverHalfWidth + 1.5,
          RESCUE_SITE.riverZ + RESCUE_SITE.riverHalfWidth - 1.5,
        ),
      );
      shark.root.position.lerpVectors(shark.start, target, approach);
      const bite = Math.sin(
        THREE.MathUtils.clamp((sharkClock - (2.8 + index * 0.2)) / 1.1, 0, 1) *
          Math.PI,
      );
      shark.root.position.y += bite * 1.35;
      shark.root.rotation.y = Math.atan2(
        riverEntry.x - shark.root.position.x,
        riverEntry.z - shark.root.position.z,
      );
      shark.mixer.update(dt * (1 + approach));
    }
    if (sharkClock >= sharkDeathAt && player.getHealth() > 0) {
      player.takeDamage(player.getHealth() + player.getShield(), true);
      deathClock = 2.5;
      if (caption)
        caption.textContent =
          "THE RIVER CLAIMED YOU / RETURNING TO THE LANDING SITE";
    }
    sharkViewCamera();
  }
  syncNearbyPhysics();
  site.updateVisibility(camera, player.body.position);
  updateHud();
  return {
    roomId: "scene17",
    getMusicTrack: () =>
      miniboss.getStatus().phase === "fight" ||
      miniboss.getStatus().phase === "versus"
        ? ("boss" as const)
        : ("planet" as const),
    scene,
    camera,
    physics,
    physicsWorld,
    player,
    ship,
    pod,
    boy,
    door,
    enemies,
    site,
    sharks,
    miniboss,
    turrets,
    ready: Promise.all([
      site.ready,
      patrolReady,
      arcadePatrolReady,
      ...(arcadeMode && dinoReady ? [dinoReady] : []),
      landSquad.ready,
      sharkReady,
      miniboss.ready,
    ]),
    cutsceneManager: null,
    minimap: { radius: 48, floor: 0, prepare: site.prepareMinimap },
    get robots() {
      return enemies.filter((enemy) => enemy.kind !== "dino");
    },
    get dinosaurs() {
      return enemies.filter((enemy) => enemy.kind === "dino");
    },
    getArcadeObjective: () => arcadeMode
      ? `FOLLOW THE FENCED TRAIL / DEFEAT THE WATERFALL WARDEN / ENEMIES ${enemies.filter((enemy) => enemy.phase !== "dormant").length}/${arcadeEnemyLimit}`
      : "",
    canPlaceMarker: (position: { x: number; y: number; z: number }) =>
      arcadeMode && (!onArcadeTrail(position, player.radius + 0.2) || position.y > 1.5 || position.y < -0.1)
        ? "Place the marker on the protected Arcade trail or inside the waterfall arena."
        : null,
    getDamageTargets: (): DamageTarget[] =>
      completed ||
      sharkClock >= 0 ||
      miniboss.isCinematic() ||
      deathClock > 0
        ? []
        : damageTargets(),
    getParryableBolts: (): ParryableBolt[] =>
      completed || sharkClock >= 0 || deathClock > 0
        ? []
        : bolts.filter((bolt) => bolt.life > 0),
    isCinematic: () =>
      completed ||
      sharkClock >= 0 ||
      miniboss.isCinematic() ||
      deathClock > 0,
    isArenaLocked: () => site.waterfall.locked,
    getRiverStatus: () => ({
      swarming: sharkClock >= 0,
      time: sharkClock,
      sharks: sharks.filter((shark) => shark.attackIndex >= 0).length,
    }),
    getCinematicDelta: () => animationDelta,
    getCinematicState: () =>
      completed ||
      sharkClock >= 0 ||
      miniboss.isCinematic() ||
      deathClock > 0
        ? {
            ...player.getState(),
            isMoving: false,
            sprinting: false,
            isOnGround: sharkClock < 0,
            floating: sharkClock >= 0,
            jumping: false,
            climbing: false,
          }
        : null,
    getCinematicPose(): CinematicPose | null {
      if (sharkClock >= 0) {
        const death = sharkClock - sharkDeathAt;
        return death >= 0
          ? {
              clip: death < 0.3 ? "Hit_Chest" : "Death01",
              time: Math.max(0, death - 0.3),
            }
          : {
              clip: "Float_Loop",
              time: sharkClock,
              loop: true,
              swimming: true,
            };
      }
      if (deathClock > 0) return { clip: "Death01", time: 2.5 - deathClock };
      return miniboss.getCinematicPose();
    },
    applyCinematicCamera: entryViewCamera,
    updateCinematicCharacter(character: { model: THREE.Object3D } | null) {
      if (character) miniboss.captureCharacter(character.model);
    },
    renderCinematicOverlay(renderer: THREE.WebGLRenderer) {
      miniboss.renderOverlay(renderer);
    },
    applyEntryCamera() {
      if (
        entryState?.cameraPosition &&
        entryState.cameraQuaternion &&
        arrivalClock < 1.1
      ) {
        const t = THREE.MathUtils.smootherstep(arrivalClock, 0, 1.1);
        camera.position.lerpVectors(
          entryState.cameraPosition,
          camera.position.clone(),
          t,
        );
        camera.quaternion.slerpQuaternions(
          entryState.cameraQuaternion,
          camera.quaternion.clone(),
          t,
        );
        camera.fov = THREE.MathUtils.lerp(entryState.cameraFov ?? 75, 75, t);
        camera.updateProjectionMatrix();
      }
    },
    restartAtCheckpoint() {
      if (disposed || completed) return false;
      completed = true;
      onRespawn(captureArrival());
      return true;
    },
    onPlayerDeath() {
      if (!deathClock && !completed) {
        deathClock = 2.5;
        stopDefense();
        freezePlayer();
        status?.classList.add("hidden");
        if (caption) {
          caption.textContent = "RETURNING TO THE LANDING SITE";
          caption.classList.remove("hidden");
        }
      }
      return true;
    },
    updatePhysics(dt: number, thirdPerson = false) {
      animationDelta = 0;
      if (
        disposed ||
        paused ||
        document.hidden ||
        document.body.classList.contains("quick-menu-open")
      )
        return;
      dt = Math.max(
        0,
        Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime),
      );
      animationDelta = dt;
      waterfallContact.headY = player.getHeadY();
      if (!arcadeMode)
        site.setBrendanActivity(
          arrivalClock < 7 && !fromFacility ? "talk" : "ambient",
        );
      site.update(dt, waterfallContact);
      updateWaterfallAudio(
        Math.hypot(
          player.body.position.x - site.waterfall.center.x,
          player.body.position.z - site.waterfall.center.z,
        ),
      );
      if (brendanBody) {
        brendanBody.position.set(
          boy.position.x,
          boy.position.y + 0.875,
          boy.position.z,
        );
        brendanBody.aabbNeedsUpdate = true;
      }
      physicsWorld.broadphase.dirty = true;
      if (deathClock > 0) {
        if (sharkClock >= 0) updateSharkSwarm(dt);
        deathClock = Math.max(0, deathClock - dt);
        if (!deathClock) {
          completed = true;
          onRespawn(captureArrival());
        }
        return;
      }
      if (completed) {
        door.update(dt, player, false);
        return;
      }
      if (sharkClock >= 0) {
        updateSharkSwarm(dt);
        return;
      }
      arrivalClock += dt;
      miniboss.update(dt);
      updateSharks(dt);
      const p = player.body.position;
      playerRoute = nearestPatrolPoint(p.x, p.z);
      if (
        !arcadeMode &&
        p.y - player.radius < RESCUE_SITE.riverY + 0.05 &&
        Math.abs(p.z - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth &&
        p.x > -79.5 &&
        player.getHealth() > 0
      ) {
        beginSharkSwarm();
        return;
      }
      if (Math.abs(p.x) < 5 && Math.abs(p.z - RESCUE_SITE.doorZ) < 10)
        doorLatched = true;
      door.update(dt, player, !arcadeMode && doorLatched);
      if (completed) return;
      syncNearbyPhysics();
      physics.step(dt, player, thirdPerson);
      for (const sentry of sentries)
        if (sentry.active) {
          sentry.actor.update(dt);
          if (sentry.actor.health <= 0 && !sentry.actor.root.visible) {
            if (sentry.body.world === physicsWorld)
              physicsWorld.removeBody(sentry.body);
            sentry.active = false;
            sentry.spent = true;
          }
        }
      for (const enemy of enemies)
        if (enemy.phase !== "dormant" && !enemy.suspended) {
          const near =
            Math.hypot(
              enemy.body.position.x - p.x,
              enemy.body.position.z - p.z,
            ) < 35;
          enemy.root.traverse((node) => {
            if (node instanceof THREE.Mesh) node.castShadow = near;
          });
          enemy.animationClock += dt;
          if (
            Math.hypot(
              enemy.body.position.x - p.x,
              enemy.body.position.z - p.z,
            ) < 28 && !arcadeMode ||
            (arcadeMode && enemy.animationClock >= 1 / 30) ||
            enemy.animationClock >= 1 / 15
          ) {
            const animationDt = enemy.animationClock;
            enemy.mixer.update(animationDt);
            enemy.animationClock = 0;
            if (
              enemy.phase === "chasing" &&
              enemy.legs &&
              enemy.action === "Run"
            ) {
              enemy.gaitClock += animationDt * 8;
              const swing = Math.sin(enemy.gaitClock) * 0.26;
              enemy.legs[0].rotateX(swing);
              enemy.legs[1].rotateX(-swing);
            }
            enemy.boundsClock -= animationDt;
            if ((!arcadeMode || enemy.boundsClock <= 0) && (arcadeMode || enemy.kind !== "dino")) {
              // Arcade refreshes conservative hit bounds at 10 Hz rather than skinning twice per frame.
              enemy.root.updateMatrixWorld(true);
              enemy.root.traverse((node) => {
                if (!(node instanceof THREE.SkinnedMesh)) return;
                node.skeleton.update();
                node.computeBoundingBox();
                if (arcadeMode && node.boundingBox) {
                  node.boundingBox.expandByScalar(0.2);
                  node.boundingSphere ??= new THREE.Sphere();
                  node.boundingBox.getBoundingSphere(node.boundingSphere);
                } else node.computeBoundingSphere();
              });
              enemy.boundsClock = 0.1;
            }
          }
        }
      updateHud();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unregister();
      stopWaterfallAudio();
      stopDefense();
      miniboss.dispose();
      landSquad.dispose();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      scene.onBeforeRender = () => {};
      physicsFocus.length = 0;
      status?.classList.add("hidden");
      caption?.classList.add("hidden");
      prompt?.classList.add("hidden");
      for (const enemy of enemies) {
        enemy.mixer.stopAllAction();
        enemy.mixer.uncacheRoot(enemy.mixer.getRoot());
        enemy.root.traverse((node) => {
          if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
        });
      }
      for (const template of templates)
        template.traverse((node) => {
          if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
        });
      for (const shark of sharks) {
        shark.mixer.stopAllAction();
        shark.mixer.uncacheRoot(shark.mixer.getRoot());
      }
      player.dispose();
      physics.dispose();
      site.dispose();
      spawnGeometry.dispose();
      spawnMaterial.dispose();
    },
  };
}
