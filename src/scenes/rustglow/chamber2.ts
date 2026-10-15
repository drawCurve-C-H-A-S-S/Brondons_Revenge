import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox } from '../../helpers/scene/shipRoom.js';
import { createShipStatusTexture } from '../../helpers/scene/shipInterior.js';
import { addDullDecoy, addRustTarget, createPendulum, createPressurePlate, createPushable, syncPushables, returnPushableTo,
  panelMaterial, deckPlateMaterial, grateMaterial, rustWallMaterial, steelMaterial, hazardMaterial } from './rustglowKit.js';
import type { ChamberContext, ChamberInstance, RouteWaypoint } from './deck.js';
import { AIDriver } from '../../scripts/aiDriver.js';

const WIDTH = 50, DEPTH = 30, HEIGHT = 14;
const RIFT_MIN_X = 22, RIFT_MAX_X = 34, RIFT_Z0 = 8, RIFT_Z1 = 14, RIFT_Z = 11;
const PLATE = new THREE.Vector3(12, 0, RIFT_Z);

export function build(ctx: ChamberContext): ChamberInstance {
  const { scene, physics, world, rust, breakables } = ctx;
  const rusted = rustWallMaterial([9, 5]);
  const rustedTall = rustWallMaterial([14, 7]);
  const deck = deckPlateMaterial([9, 7]);
  const grate = grateMaterial([5, 4]);
  const beam = steelMaterial(0x4e5c6b);
  const trim = steelMaterial(0x8b9dab);
  const box = (size: [number, number, number], at: [number, number, number], mat: THREE.Material = beam, solid = true) =>
    roomBox(scene, physics, size, at, mat, solid);
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 });
  function cable(from: THREE.Vector3, to: THREE.Vector3, radius = 0.05) {
    const dir = to.clone().sub(from);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 6), cableMat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    scene.add(mesh);
    return mesh;
  }

  // ---- Shell: west and east ledges, and a twelve-metre rift no sprint jump will clear.
  box([WIDTH, 0.4, RIFT_Z0], [WIDTH / 2, -0.2, RIFT_Z0 / 2], deck);
  box([WIDTH, 0.4, DEPTH - RIFT_Z1], [WIDTH / 2, -0.2, (RIFT_Z1 + DEPTH) / 2], deck);
  box([RIFT_MIN_X, 0.4, RIFT_Z1 - RIFT_Z0], [RIFT_MIN_X / 2, -0.2, RIFT_Z], deck);
  box([WIDTH - RIFT_MAX_X, 0.4, RIFT_Z1 - RIFT_Z0], [(RIFT_MAX_X + WIDTH) / 2, -0.2, RIFT_Z], deck);
  box([RIFT_MAX_X - RIFT_MIN_X + 0.6, 0.4, DEPTH], [(RIFT_MIN_X + RIFT_MAX_X) / 2, -5.4, DEPTH / 2], rusted);
  box([WIDTH, 0.5, DEPTH], [WIDTH / 2, HEIGHT + 0.25, DEPTH / 2], beam, false);
  box([WIDTH, 1.4, DEPTH - 4], [WIDTH / 2, HEIGHT - 0.7, DEPTH / 2], beam, false);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, -0.2], rustedTall);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, DEPTH + 0.2], rustedTall);
  box([0.4, HEIGHT, DEPTH], [-0.2, HEIGHT / 2, DEPTH / 2], rustedTall);
  // East wall with the exit opening at z 8-14.
  box([0.4, HEIGHT, RIFT_Z0], [WIDTH + 0.2, HEIGHT / 2, RIFT_Z0 / 2], rustedTall);
  box([0.4, HEIGHT, DEPTH - RIFT_Z1], [WIDTH + 0.2, HEIGHT / 2, (RIFT_Z1 + DEPTH) / 2], rustedTall);
  box([0.4, HEIGHT - 5, RIFT_Z1 - RIFT_Z0], [WIDTH + 0.2, 5 + (HEIGHT - 5) / 2, RIFT_Z], rustedTall);
  for (const z of [5, 10, 15, 20, 25]) {
    box([WIDTH - 1, 0.7, 0.45], [WIDTH / 2, HEIGHT - 0.9, z], beam, false);
    for (const x of [10, 20, 30, 40]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 0.3), beam);
      web.position.set(x, HEIGHT - 1.1, z);
      web.rotation.z = x < 25 ? 0.5 : -0.5;
      scene.add(web);
    }
  }
  for (const [x, z] of [[6, 4], [44, 4], [6, 26], [44, 26], [16, 4], [40, 26]]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, HEIGHT, 8), steelMaterial(0x5f6d78));
    pier.position.set(x, HEIGHT / 2, z);
    scene.add(pier);
    box([1.8, 0.5, 1.8], [x, 0.25, z], trim);
    physics.addBox({ x: 1.6, y: HEIGHT, z: 1.6 }, { x, y: HEIGHT / 2, z });
  }

  // ---- Rift escape shelves and lip rails: a fall costs a climb, not a reset.
  for (const index of [0, 1, 2]) {
    box([1.6, 0.22, 1.6], [RIFT_MIN_X + 0.8, -3.4 + index * 1.3, 3 + index * 7], grate);
    box([1.6, 0.22, 1.6], [RIFT_MAX_X - 0.8, -3.4 + index * 1.3, 16 + (index % 2) * 6], grate);
  }
  for (const x of [RIFT_MIN_X + 0.3, RIFT_MAX_X - 0.3]) {
    box([0.14, 0.14, DEPTH - 2], [x, 0.9, DEPTH / 2], trim, false);
    for (const z of [4, 10, 16, 22, 28]) box([0.12, 1.05, 0.12], [x, 0.5, z], trim, false);
  }

  // ---- The raised drawbridge, hinged along z at the west lip. Twelve metres of span.
  const bridge = new THREE.Group();
  bridge.position.set(RIFT_MIN_X, 0, RIFT_Z);
  const deckPlate = new THREE.Mesh(new THREE.BoxGeometry(RIFT_MAX_X - RIFT_MIN_X, 0.4, 4), deckPlateMaterial([4, 2]));
  deckPlate.position.set((RIFT_MAX_X - RIFT_MIN_X) / 2, 0.2, 0);
  deckPlate.castShadow = true; deckPlate.receiveShadow = true;
  bridge.add(deckPlate);
  for (const z of [-1.7, 1.7]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(RIFT_MAX_X - RIFT_MIN_X, 0.5, 0.18), beam);
    rib.position.set((RIFT_MAX_X - RIFT_MIN_X) / 2, -0.15, z);
    bridge.add(rib);
  }
  for (const x of [3, 6, 9]) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 3.6), beam);
    tie.position.set(x, -0.45, 0);
    bridge.add(tie);
  }
  scene.add(bridge);
  const bridgeBody = new CANNON.Body({ mass: 0 });
  bridgeBody.addShape(new CANNON.Box(new CANNON.Vec3((RIFT_MAX_X - RIFT_MIN_X) / 2, 0.2, 2)));
  world.addBody(bridgeBody);
  let bridgeAngle = Math.PI / 2, bridgeFalling = false;
  function syncBridge() {
    bridge.rotation.z = bridgeAngle;
    bridge.updateWorldMatrix(true, false);
    const center = deckPlate.getWorldPosition(new THREE.Vector3());
    bridgeBody.position.set(center.x, center.y, center.z);
    bridgeBody.quaternion.set(bridge.quaternion.x, bridge.quaternion.y, bridge.quaternion.z, bridge.quaternion.w);
    bridgeBody.aabbNeedsUpdate = true;
  }

  // ---- Rampart: stair climbs east along the south wall, catwalks turn north over the west lip.
  const rampartStair = physics.addStaircase({ width: 2.2, run: 4.4, rise: 4.4, position: { x: 10, y: 0, z: 24 }, material: grate, yaw: Math.PI / 2 });
  scene.add(rampartStair.group);
  box([8, 0.3, 2.4], [18, 4.4, 24], grate);
  box([2.4, 0.3, 10.6], [20.8, 4.4, 18.8], grate);
  box([3.2, 0.3, 6], [20.4, 4.4, RIFT_Z], grate);
  box([0.1, 1, 10.6], [19.65, 5.05, 18.8], trim, false);
  box([8, 1, 0.1], [18, 5.05, 22.85], trim, false);
  box([3.2, 1, 0.1], [20.4, 5.05, RIFT_Z0 - 0.05], trim, false);
  for (const [x, z] of [[14.6, 24], [21.4, 24], [20.8, 15], [19.2, RIFT_Z], [21.6, RIFT_Z]]) box([0.3, 4.4, 0.3], [x, 2.2, z], beam);
  const rampartLight = new THREE.PointLight(0xffd8a8, 16, 14, 2);
  rampartLight.position.set(20.4, 6.4, 14);
  scene.add(rampartLight);

  // ---- Pendulum rig over open air: 200 kg cube on a seven-metre cable, tie-backed east.
  const anchor = new THREE.Vector3(12, 9.6, RIFT_Z);
  const cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: panelMaterial([1, 1], { base: '#51606c', seam: '#39434c', rivet: '#2c343c' }).map ?? undefined, metalness: 0.6, roughness: 0.5 }));
  cubeMesh.castShadow = true;
  scene.add(cubeMesh);
  box([1.4, 1.2, 1.4], [anchor.x, 10.35, anchor.z], beam, false);
  cable(new THREE.Vector3(anchor.x, 10.35, anchor.z), new THREE.Vector3(anchor.x, HEIGHT - 1.4, anchor.z), 0.08);
  const pendulum = createPendulum({
    parent: scene, anchor, axis: new THREE.Vector3(1, 0, 0), length: 7, startAngle: 0.9, bob: cubeMesh,
  });
  const tetherAnchor = new THREE.Vector3(34.3, 3.2, RIFT_Z);
  let tetherGone = ctx.isBroken('c2:WC');
  let seated = false, fallingBody: CANNON.Body | null = null;

  const plate = createPressurePlate(scene, PLATE, new THREE.Vector3(3, 0.3, 3), { minMass: 30, playerArms: false });
  const plateRing = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 6, 24), hazardMaterial());
  plateRing.position.set(PLATE.x, 0.06, PLATE.z);
  plateRing.rotation.x = Math.PI / 2;
  scene.add(plateRing);
  const watched: CANNON.Body[] = [];
  const spares: Array<{ mesh: THREE.Mesh; body: CANNON.Body }> = [];

  function seatCube() {
    seated = true;
    pendulum.stop();
    cubeMesh.position.set(PLATE.x, 0.62, PLATE.z);
    cubeMesh.quaternion.identity();
    const body = new CANNON.Body({ mass: 200, type: CANNON.Body.STATIC });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
    body.position.set(PLATE.x, 0.62, PLATE.z);
    world.addBody(body);
    watched.push(body);
    ctx.say('The load seats. Magnets grab - the plate sinks.', 4);
  }

  // Tie-back clamp on the rift-east bracket: cut it and the load swings west over the plate.
  box([0.5, 3.2, 0.5], [34.3, 1.6, RIFT_Z], beam);
  const wcMat = rust.material('normal', { scale: 1.3 });
  const wc = breakables.add('c2:WC', 'crowbar', new THREE.Vector3(33.9, 3.2, RIFT_Z), new THREE.Vector3(0.5, 1.1, 0.9), () => {
    tetherGone = true;
    tether.visible = false;
    world.removeBody(tetherBody);
    pendulum.start();
    ctx.say('Tie-back let go - the load is swinging west over the plate. Time your cut.', 5);
  }, {
    material: wcMat,
    onDamaged: () => { wcMat.uniforms.uHitFlash.value = 1.2; },
  });
  const wcBracket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 1.2), beam);
  wcBracket.position.set(0.4, 0.1, 0);
  wc.root.add(wcBracket);
  const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), cableMat);
  scene.add(tether);
  const tetherBody = physics.addBox({ x: 17.3, y: 0.12, z: 0.12 }, { x: (17.5 + 34.3) / 2, y: 4.2, z: RIFT_Z });
  if (tetherGone) { tether.visible = false; world.removeBody(tetherBody); }
  function placeTether() {
    if (tetherGone || tether.visible === false) return;
    const p = cubeMesh.position;
    const span = new THREE.Vector3().subVectors(tetherAnchor, p);
    tether.position.copy(p.clone().add(span.clone().multiplyScalar(0.5)));
    tether.scale.set(1, Math.max(0.1, span.length()), 1);
    tether.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
  }

  // Swing-cable clamp: cut while the load passes the plate and it seats instead of falling.
  const taMat = rust.material('normal', { scale: 1.1 });
  const ta = breakables.add('c2:TA', 'crowbar', new THREE.Vector3(15.1, 7.1, RIFT_Z),
    new THREE.Vector3(0.45, 1.5, 0.45), () => {
      if (!tetherGone || seated) return;
      const p = cubeMesh.position;
      if (Math.hypot(p.x - PLATE.x, p.z - PLATE.z) < 1.6) seatCube();
      else fallingBody = pendulum.release(world);
    }, {
      material: taMat,
      onDamaged: () => { taMat.uniforms.uHitFlash.value = 1.2; },
    });
  const taShackle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 18), trim);
  taShackle.position.set(0, -0.9, 0);
  ta.root.add(taShackle);
  cable(new THREE.Vector3(14.6, 5.9, RIFT_Z), new THREE.Vector3(15.1, 7.1, RIFT_Z), 0.04);
  box([2.6, 0.2, 2.2], [14.6, 5.7, RIFT_Z], grate); // cut platform, one hop from the rampart deck
  for (const [x, z] of [[13.6, 10.2], [15.6, 10.2], [13.6, 11.8], [15.6, 11.8]]) box([0.12, 5.7, 0.12], [x, 2.85, z], beam, false);

  // Hinge pin cluster: three hits shear it and the span falls across the rift.
  const pinMat = rust.material('heavy');
  const pin = breakables.add('c2:H1', 'crowbar', new THREE.Vector3(21.45, 6.4, RIFT_Z), new THREE.Vector3(0.55, 1.3, 2.2), () => {
    bridgeFalling = true;
    ctx.say('The pin shears. Twelve metres of span are finding the far lip.', 4);
  }, {
    hits: 3, material: pinMat,
    onDamaged: (_id, hitsLeft) => {
      pinMat.uniforms.uDamageStage.value = Math.max(0, 3 - hitsLeft);
      pinMat.uniforms.uHitFlash.value = 1.2;
    },
  });
  for (const z of [-0.8, 0.8]) {
    const clevis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), beam);
    clevis.position.set(0, 0.8, z);
    pin.root.add(clevis);
  }
  if (ctx.isBroken('c2:H1')) { bridgeAngle = 0; }
  syncBridge();

  // Anchor brake: the blue pistol shell up on the rig. Shooting it drops the load anywhere.
  const abMat = rust.material('pistol', { scale: 1.1 });
  const ab = breakables.add('c2:AB1', 'pistol', new THREE.Vector3(12, 11.2, RIFT_Z), new THREE.Vector3(1.2, 0.8, 0.9), () => {
    tetherGone = true;
    tether.visible = false;
    world.removeBody(tetherBody);
    if (!seated) fallingBody = pendulum.release(world);
    ctx.say('Anchor gone. The whole rig comes down - wherever that lands.', 4);
  }, {
    material: abMat,
    onDamaged: () => { abMat.uniforms.uHitFlash.value = 1.2; },
  });
  const abHousing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.2), beam);
  abHousing.position.set(0, 0.55, 0);
  ab.root.add(abHousing);
  void ta; void wc; void ab; void pin;

  // ---- Recycler hatch behind the west ledge replaces a cube lost in the rift.
  box([2.2, 0.5, 2.2], [5, 0.1, 24], rusted);
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2), trim);
  hatch.position.set(5, 0.42, 24);
  scene.add(hatch);
  const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 6, 20), hazardMaterial());
  hatchRing.position.set(5, 0.5, 24);
  hatchRing.rotation.x = Math.PI / 2;
  scene.add(hatchRing);
  let spareTimer = -1;

  // ---- Stores crate: push it to the rift-east bracket for a comfortable tie-back swing.
  const crateMat = new THREE.MeshStandardMaterial({ map: panelMaterial([1, 1], { base: '#7a6248', seam: '#5c4634', rivet: '#4a3826' }).map ?? undefined, roughness: 0.85 });
  const crate = createPushable(scene, world, new THREE.Vector3(40, 0.7, 16), new THREE.Vector3(1.4, 1.4, 1.4), 20, crateMat);
  const props = [crate];
  addDullDecoy(scene, physics, rust, new THREE.Vector3(38, 0.9, 4), new THREE.Vector3(3.4, 1.8, 0.6), Math.PI / 2);
  addDullDecoy(scene, physics, rust, new THREE.Vector3(46, 1.4, 26), new THREE.Vector3(0.7, 2.8, 3));

  // ---- Lore signage and living deck.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.0),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('COUNTERWEIGHT BAY - SPAN 7C-2', ['DRAWBRIDGE UNDER BLOOM LOCK', 'DO NOT CYCLE SPAN MANUALLY'], 0xff9a4a) }));
  sign.position.set(12, 3.4, 0.25);
  scene.add(sign);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('FERRO-BLOOM ADVISORY', ['ORANGE: CROWBAR KINETICS', 'BLUE: SIDEARM BALLISTICS'], 0x4fd6ff) }));
  plaque.position.set(0.25, 2.2, 20);
  plaque.rotation.y = Math.PI / 2;
  scene.add(plaque);
  const fans: THREE.Group[] = [];
  for (const [fx, fz] of [[25, 0.25], [25, DEPTH - 0.25]]) {
    const unit = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 24), beam);
    unit.add(ring);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.36), steelMaterial(0x77858f));
      blade.position.x = 0.7;
      blade.rotation.x = 0.5;
      const pivot = new THREE.Group();
      pivot.rotation.z = i * Math.PI / 2;
      pivot.add(blade);
      blades.add(pivot);
    }
    unit.add(blades);
    unit.position.set(fx, 7, fz);
    scene.add(unit);
    fans.push(blades);
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330806, emissive: 0xff3020, emissiveIntensity: 2 });
  const beacons: THREE.Mesh[] = [];
  for (const [bx, bz] of [[RIFT_MIN_X - 0.4, 9], [RIFT_MAX_X + 0.4, 13], [5, 24]]) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), beaconMat);
    beacon.position.set(bx, 1.1, bz);
    scene.add(beacon);
    beacons.push(beacon);
  }
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffb478, transparent: true, opacity: 0.1, depthWrite: false });
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3), steamMat);
  steam.position.set(28, -2, RIFT_Z);
  steam.rotation.y = Math.PI / 2;
  scene.add(steam);
  const riftGlow = new THREE.PointLight(0xff7a30, 14, 16, 2);
  riftGlow.position.set(28, -3.5, RIFT_Z);
  scene.add(riftGlow);
  const lamps: THREE.PointLight[] = [];
  for (const at of [[12, 8, RIFT_Z], [33, 5, RIFT_Z], [25, 11.5, RIFT_Z], [6, 6, 24], [44, 6, 11]]) {
    const lamp = new THREE.PointLight(0xff9a52, 16, 20, 2);
    lamp.position.set(at[0], at[1], at[2]);
    scene.add(lamp);
    lamps.push(lamp);
  }
  scene.add(new THREE.HemisphereLight(0x8fa8bd, 0x33281e, 1.8));
  const hallKey = new THREE.DirectionalLight(0xd8e6f2, 0.9);
  hallKey.position.set(-0.3, 1, -0.4);
  scene.add(hallKey);

  let greeted = false, doorSignalled = false, clock = 0;
  const route: RouteWaypoint[] = [
    { p: [2.5, 0.4, 24], pause: 1.5, caption: '1. Counterweight bay - twelve metres of rift between you and the door.' },
    { p: [10, 0.4, 24], pause: 0.6, caption: '2. Stair up to the rampart beside the hinge.' },
    { p: [14.4, 4.7, 24], pause: 0.3 },
    { p: [20.4, 4.7, 12], pause: 2, caption: '3. Three crowbar hits on the hinge pin cluster. The span falls across the rift.' },
    { p: [28, 0.6, 11], pause: 1.5, caption: '4. Cross the span to the east ledge.' },
    { p: [34.3, 0.4, 11], pause: 2, caption: '5. Cut the tie-back clamp on the bracket - push the crate under it first if the jump-swing is fiddly.' },
    { p: [20.4, 4.7, 12], pause: 0.6, caption: '6. Back across, up the rampart, one hop to the cut platform.' },
    { p: [14.6, 6.0, 11], pause: 2.5, caption: '7. When the cube swings over the plate ring - cut the swing cable. It seats, the plate sinks.' },
    { p: [28, 0.6, 11], pause: 1, caption: '8. Plate armed. Cross for good and take the east door.' },
    { p: [46, 0.4, 11], pause: 1.5 },
  ];

  // AI driver for automated playthrough - controls the actual player
  const ai = ctx.player ? new AIDriver(ctx.player) : null;
  ai?.setWaypoints([
    // Navigate to stair base
    { position: new THREE.Vector3(8, 0.4, 24), action: 'wait', actionDelay: 0.5 },
    // Climb stairs - intermediate waypoint halfway up
    { position: new THREE.Vector3(14, 2.5, 24), action: 'wait', actionDelay: 0.5 },
    // Reach top of stairs
    { position: new THREE.Vector3(18, 4.7, 24), action: 'wait', actionDelay: 0.5 },
    // Walk along catwalk to hinge pin
    { position: new THREE.Vector3(20.4, 4.7, 12), action: 'attack', actionDelay: 0.5 }, // Hit hinge pin
    { position: new THREE.Vector3(20.4, 4.7, 12), action: 'attack', actionDelay: 0.5 }, // Hit hinge pin
    { position: new THREE.Vector3(20.4, 4.7, 12), action: 'attack', actionDelay: 0.5 }, // Hit hinge pin
    // Cross bridge (now at ground level after bridge falls)
    { position: new THREE.Vector3(28, 0.6, 11), action: 'wait', actionDelay: 1.5 },
    // Cut tie-back clamp on east bracket
    { position: new THREE.Vector3(34.3, 0.4, 11), action: 'attack', actionDelay: 0.5 },
    // Return west and jump to cut platform
    { position: new THREE.Vector3(20.4, 4.7, 12), action: 'wait', actionDelay: 0.5 },
    { position: new THREE.Vector3(14.6, 6.0, 11), action: 'wait', actionDelay: 5.0 }, // Wait for pendulum
    { position: new THREE.Vector3(14.6, 6.0, 11), action: 'attack', actionDelay: 0.5,
      condition: () => {
        // Only attack when pendulum is over plate
        const bobPos = pendulum.bobPosition();
        return Math.hypot(bobPos.x - PLATE.x, bobPos.z - PLATE.z) < 1.6;
      }
    }, // Cut swing cable
    // Exit east
    { position: new THREE.Vector3(28, 0.6, 11), action: 'wait', actionDelay: 1.0 },
    { position: new THREE.Vector3(46, 0.4, 11), action: 'wait', actionDelay: 1.0 },
  ]);
  let aiActive = false;
  return {
    route,
    spawn: { x: 2.5, y: PHYSICS.playerRadius + 0.15, z: 24, yaw: -Math.PI / 2 },
    resetTerminal: { x: 1.6, z: 28.4, yaw: Math.PI / 2 },
    exitGate: { frame: { x: WIDTH + 0.3, y: 0, z: RIFT_Z, yaw: -Math.PI / 2 }, span: 6, height: HEIGHT, label: '02 / COUNTERWEIGHT' },
    previewCamera: { position: new THREE.Vector3(25, 11, 2), lookAt: new THREE.Vector3(25, 2, 16) },
    bounds: { minX: 0, maxX: WIDTH + 2.5, minZ: 0, maxZ: DEPTH },
    objective: () => 'CHAMBER 02 - COUNTERWEIGHT: shear the hinge pin, drop the span, cut the swing over the plate. The rift is not a jump.',
    activateBot: () => {
      console.log('[chamber2] activateBot called, ai:', !!ai, 'player:', !!ctx.player, 'enabled:', ctx.player?.isEnabled());
      if (!ai) { ctx.say('AI driver unavailable - no player.', 3); return; }
      if (!ctx.player?.isEnabled()) {
        console.warn('[chamber2] Player not enabled, enabling now');
        ctx.player?.enable();
      }
      aiActive = true; ai.activate(); ctx.say('AI driver activated. Controlling player.', 3);
      console.log('[chamber2] AI driver activated, waypoints:', ai.getCurrentWaypoint());
      // Request pointer lock so camera control works
      if (document.pointerLockElement == null) {
        console.log('[chamber2] Requesting pointer lock');
        document.body.requestPointerLock();
      }
    },
    update(dt) {
      clock += dt;
      syncPushables(props);
      pendulum.update(dt);

      // Update AI driver
      if (ai && aiActive && !ai.isComplete()) {
        const result = ai.update(dt);
        if (result.attack) {
          // Request melee attack action
          ctx.player?.requestAction('Sword_Attack');
        }
        // Auto-advance attack waypoints
        const waypoint = ai.getCurrentWaypoint();
        if (waypoint?.action === 'attack' && result.attack) {
          ai.advanceWaypoint();
        }
      }

      if (fallingBody && fallingBody.world === world) {
        cubeMesh.position.copy(fallingBody.position as unknown as THREE.Vector3);
        cubeMesh.quaternion.copy(fallingBody.quaternion as unknown as THREE.Quaternion);
      }
      placeTether();
      if (bridgeFalling) {
        bridgeAngle = Math.max(0, bridgeAngle - dt * (Math.PI / 2) / 2.6);
        if (bridgeAngle === 0) bridgeFalling = false;
        syncBridge();
      }
      plate.update(dt, ctx.player, watched);
      const loadY = fallingBody ? fallingBody.position.y : cubeMesh.position.y;
      if (!seated && !fallingBody && pendulum.bobPosition().y < -2 && spareTimer < 0) spareTimer = 10;
      if (!seated && fallingBody && loadY < -3 && spareTimer < 0) spareTimer = 10;
      if (spareTimer > 0) {
        spareTimer -= dt;
        if (spareTimer <= 0) {
          const spare = new CANNON.Body({ mass: 40, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)) });
          spare.position.set(5, 1.2, 24);
          spare.linearDamping = 0.2;
          world.addBody(spare);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), crateMat);
          scene.add(mesh);
          watched.push(spare);
          spares.push({ mesh, body: spare });
          ctx.say('The recycler coughs. A service cube rides up behind the hatch.', 4);
          spareTimer = -1;
        }
      }
      for (const spare of spares) {
        spare.mesh.position.copy(spare.body.position as unknown as THREE.Vector3);
        spare.mesh.quaternion.copy(spare.body.quaternion as unknown as THREE.Quaternion);
      }
      if (!doorSignalled && plate.loaded()) {
        doorSignalled = true;
        ctx.openExit();
        ctx.say('Plate armed. The east lock cycles open.', 3);
      }
      for (const blades of fans) blades.rotation.z += dt * 1.5;
      beaconMat.emissiveIntensity = clock % 1.6 < 0.25 ? 3.2 : 0.25;
      lamps[2].intensity = 16 * (0.72 + 0.28 * Math.sin(clock * 11) * Math.sin(clock * 3.7));
      steamMat.opacity = 0.07 + 0.05 * Math.sin(clock * 1.3);
      riftGlow.intensity = 14 + 3 * Math.sin(clock * 2.1);
      if (!greeted && !ctx.preview && ctx.player?.isEnabled()) {
        greeted = true;
        ctx.say('Prime: Counterweight bay, and look at that rift - nothing jumps twelve metres, not even you. Donus raised the span and bloomed the hinge pin; three crowbar hits shears it and the span becomes your bridge. The tie-back and the swing cable are orange; the brake shell up on the rig is blue, so pistols only. Mind the lip; the shelves catch you.', 14);
      }
    },
    reset() {
      aiActive = false;
      ai?.deactivate();
      pendulum.reset();
      seated = false; spareTimer = -1; doorSignalled = false; tetherGone = false; fallingBody = null;
      bridgeAngle = Math.PI / 2; bridgeFalling = false;
      tether.visible = true;
      if (tetherBody.world !== world) world.addBody(tetherBody);
      for (const spare of spares) { spare.mesh.removeFromParent(); world.removeBody(spare.body); }
      spares.length = 0;
      watched.length = 0;
      plate.reset();
      returnPushableTo(crate, new THREE.Vector3(40, 0.7, 16));
      syncBridge();
      placeTether();
    },
  };
}
