import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, createSlidingPortal } from '../../helpers/scene/shipRoom.js';
import { createShipStatusTexture } from '../../helpers/scene/shipInterior.js';
import { addDullDecoy, addRustTarget, createHandhold, createDecompression, createPressurePlate,
  createSwingingLatch, panelMaterial, deckPlateMaterial, grateMaterial, rustWallMaterial, steelMaterial, hazardMaterial } from './rustglowKit.js';
import type { ChamberContext, ChamberInstance, RouteWaypoint } from './deck.js';

const WIDTH = 34, DEPTH = 20, HEIGHT = 12;

export function build(ctx: ChamberContext): ChamberInstance {
  const { scene, physics, world, rust, breakables } = ctx;
  const rusted = rustWallMaterial([8, 4]);
  const rustedTall = rustWallMaterial([12, 6]);
  const deck = deckPlateMaterial([8, 6]);
  const grate = grateMaterial([5, 4]);
  const beam = steelMaterial(0x4e5c6b);
  const trim = steelMaterial(0x8b9dab);
  const box = (size: [number, number, number], at: [number, number, number], mat: THREE.Material = beam, solid = true) =>
    roomBox(scene, physics, size, at, mat, solid);

  // ---- Shell: vestibule x 0-6, bay x 7-22, lock x 23-27, Door X opening east at z 7.5-10.5.
  box([WIDTH, 0.4, DEPTH], [WIDTH / 2, -0.2, DEPTH / 2], deck);
  box([WIDTH, 0.5, DEPTH], [WIDTH / 2, HEIGHT + 0.25, DEPTH / 2], beam, false);
  box([WIDTH, 1.4, DEPTH - 4], [WIDTH / 2, HEIGHT - 0.7, DEPTH / 2], beam, false);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, -0.2], rustedTall);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, DEPTH + 0.2], rustedTall);
  box([0.4, HEIGHT, DEPTH], [-0.2, HEIGHT / 2, DEPTH / 2], rustedTall);
  box([0.4, HEIGHT, 7.5], [WIDTH + 0.2, HEIGHT / 2, 3.75], rustedTall);
  box([0.4, HEIGHT, DEPTH - 10.5], [WIDTH + 0.2, HEIGHT / 2, (10.5 + DEPTH) / 2], rustedTall);
  box([0.4, HEIGHT - 4.6, 3], [WIDTH + 0.2, 4.6 + (HEIGHT - 4.6) / 2, 9], rustedTall);
  // Vestibule wall with the hatched opening at z 6.5-9.5.
  box([0.6, HEIGHT, DEPTH - 3], [6.3, HEIGHT / 2, 1.5 + (DEPTH - 3) / 2], rusted);
  box([0.6, HEIGHT - 4, 3], [6.3, 4 + (HEIGHT - 4) / 2, 8], rusted);
  // Bay/lock divider with the 4 m rail opening at z 6-10.
  box([0.6, HEIGHT, DEPTH - 4], [22.3, HEIGHT / 2, 2 + (DEPTH - 4) / 2], rusted);
  box([0.6, HEIGHT - 4, 4], [22.3, 4 + (HEIGHT - 4) / 2, 8], rusted);
  for (const z of [4, 8, 12, 16]) box([WIDTH - 1, 0.6, 0.4], [WIDTH / 2, HEIGHT - 0.9, z], beam, false);
  for (const [x, z] of [[10, 4], [18, 4], [10, 16], [18, 16]]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, HEIGHT, 8), steelMaterial(0x5f6d78));
    pier.position.set(x, HEIGHT / 2, z);
    scene.add(pier);
    box([1.6, 0.5, 1.6], [x, 0.25, z], trim);
    physics.addBox({ x: 1.4, y: HEIGHT, z: 1.4 }, { x, y: HEIGHT / 2, z });
  }

  // ---- Hatch H0 behind the planks and the chain.
  const hatch = createSlidingPortal(scene, physics, { x: 6.3, y: 0, z: 8, yaw: -Math.PI / 2 }, 5, HEIGHT,
    'HATCH H0', { doorHeight: 4 });
  hatch.setLocked(true);

  // ---- Vestibule balcony stair and the catwalk spur that reaches the trolley brake.
  const stair = physics.addStaircase({ width: 2.2, run: 8.6, rise: 7.2, position: { x: 1.6, y: 0, z: 1.6 }, material: grate, yaw: 0 });
  scene.add(stair.group);
  box([5.4, 0.35, 4], [3.3, 7.2, 11], grate);
  box([2.6, 0.35, 2.4], [6.7, 7.2, 8], grate);
  for (const z of [6.8, 9.2]) box([0.1, 1, 2.4], [5.4, 7.9, 8], trim, false);
  box([0.1, 1, 4], [0.7, 7.9, 11], trim, false);
  box([5.4, 1, 0.1], [3.3, 7.9, 13], trim, false);
  for (const [x, z] of [[1.2, 9.5], [5.4, 9.5], [5.4, 12.5]]) box([0.3, 7.2, 0.3], [x, 3.6, z], beam);

  // ---- Overhead rail into the lock, trolley and its hanging load.
  box([16.5, 0.25, 0.4], [16.75, 8.1, 8], trim, false);
  for (const x of [10, 14, 18, 22]) box([0.3, 0.6, 0.3], [x, 8.5, 8], beam, false);
  const trolley = new THREE.Group();
  const trolleyBodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.2), steelMaterial(0x6a7883));
  trolley.add(trolleyBodyMesh);
  for (const x of [-0.5, 0.5]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10), trim);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.32, 0);
    trolley.add(wheel);
  }
  trolley.position.set(9, 8.0, 8);
  scene.add(trolley);
  const loadCable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 5.9, 6), new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 }));
  scene.add(loadCable);
  const load = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4),
    new THREE.MeshStandardMaterial({ map: panelMaterial([1, 1], { base: '#51606c', seam: '#39434c', rivet: '#2c343c' }).map ?? undefined, metalness: 0.6, roughness: 0.5 }));
  load.castShadow = true;
  load.position.set(9, 1.75, 8);
  scene.add(load);
  const loadStripe = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 1.42), hazardMaterial());
  load.add(loadStripe);
  const loadBody = new CANNON.Body({ mass: 200, shape: new CANNON.Box(new CANNON.Vec3(0.7, 0.7, 0.7)) });
  loadBody.type = CANNON.Body.STATIC;
  loadBody.position.set(9, 1.75, 8);
  world.addBody(loadBody);
  let trolleyX = 9, trolleySpeed = 0, trolleyRunning = false, loadDropped = false;

  // ---- Hatch fasteners: three planks and a heavy chain down the seam.
  for (const [index, y] of [0.8, 2, 3.2].entries()) {
    const plank = addRustTarget(breakables, rust, `c5:P${index + 1}`, new THREE.Vector3(6.3, y, 8), new THREE.Vector3(0.35, 0.6, 2.8),
      { tone: 'normal' }, () => checkHatch());
    for (const z of [-1.2, 1.2]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), trim);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(0, 0, z);
      plank.root.add(bolt);
    }
  }
  const chainMat = rust.material('heavy');
  const chainGroup = new THREE.Group();
  for (const [index, linkY] of [3.3, 2.9, 2.5, 2.1, 1.7, 1.3, 0.9].entries()) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.075, 10, 20), chainMat);
    ring.position.set(6.3, linkY, 9.6);
    ring.rotation.y = Math.PI / 2;
    ring.rotation.x = index % 2 ? 1.35 : 0.22;
    ring.castShadow = true;
    chainGroup.add(ring);
  }
  const chainClevis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.6), beam);
  chainClevis.position.set(6.3, 0.5, 9.6);
  chainGroup.add(chainClevis);
  scene.add(chainGroup);
  const chainItem = breakables.add('c5:CH', 'crowbar', new THREE.Vector3(6.3, 2, 9.6), new THREE.Vector3(0.35, 3.2, 0.5), () => {
    chainGroup.visible = false;
    checkHatch();
  }, {
    hits: 3, material: chainMat,
    onDamaged: (_id, hitsLeft) => {
      chainMat.uniforms.uDamageStage.value = Math.max(0, 3 - hitsLeft);
      chainMat.uniforms.uHitFlash.value = 1.2;
    },
  });
  chainItem.root.traverse(node => { if (node instanceof THREE.Mesh) node.visible = false; });
  chainItem.root.add(chainGroup);
  chainGroup.position.set(-6.3, -2, -9.6);
  function checkHatch() {
    const left = breakables.objects.filter(item => item.id.startsWith('c5:') && !item.broken && /^(c5:P\d|c5:CH)$/.test(item.id)).length;
    if (left === 0) ctx.say('Last fastener gone. Hatch H0 can unseal.', 3);
    else ctx.say(`The hatch breathes, but ${left} fastener${left === 1 ? '' : 's'} hold${left === 1 ? 's' : ''}.`, 3);
  }

  // ---- Trolley brake (heavy, crowbar) and its blue sprocket shell (pistol) on the far side.
  addRustTarget(breakables, rust, 'c5:BK', new THREE.Vector3(8.2, 7.55, 8), new THREE.Vector3(0.7, 0.8, 0.9),
    { tone: 'heavy', hits: 3 }, () => {
      trolleyRunning = true;
      ctx.say('Brake sheared. The trolley is picking up speed down the rail.', 3);
    });
  if (ctx.isBroken('c5:BK')) trolleyRunning = true;
  addRustTarget(breakables, rust, 'c5:BS', new THREE.Vector3(10.4, 7.9, 8.5), new THREE.Vector3(0.6, 0.6, 0.4),
    { weapon: 'pistol', tone: 'pistol' }, () => {
      if (!trolleyRunning) {
        trolleyRunning = true;
        ctx.say('Sprocket shell shatters. The brake releases - pistols have their uses.', 3);
      }
    });
  const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12), trim);
  sprocket.rotation.x = Math.PI / 2;
  sprocket.position.set(10.4, 7.9, 8.2);
  scene.add(sprocket);
  const cableBand = addRustTarget(breakables, rust, 'c5:C1', new THREE.Vector3(9, 2.2, 8), new THREE.Vector3(0.55, 1.8, 0.55),
    { tone: 'normal' }, () => {
      if (loadDropped) return;
      loadDropped = true;
      loadBody.type = CANNON.Body.DYNAMIC;
      loadBody.mass = 200;
      loadBody.updateMassProperties();
      loadBody.aabbNeedsUpdate = true;
      ctx.say('Cable cut. Two tonnes of ballast are falling.', 2);
    });
  const cableSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8), trim);
  cableBand.root.add(cableSleeve);

  // ---- Mass plate in the lock, with a hazard ring so the drop zone reads.
  const plate = createPressurePlate(scene, new THREE.Vector3(25, 0, 8), new THREE.Vector3(3, 0.3, 3), { minMass: 30, playerArms: false });
  const plateRing = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 6, 24), hazardMaterial());
  plateRing.position.set(25, 0.06, 8);
  plateRing.rotation.x = Math.PI / 2;
  scene.add(plateRing);
  let seated = false;

  // ---- Service steps so the umbilical clamp is actually in crowbar reach.
  for (const [i, y] of [0.6, 1.8, 3.0, 4.2].entries()) {
    box([1.4, 0.24, 1.4], [26.6 - i * 1.0, y, 12.4], grate);
  }
  box([1.6, 0.24, 1.6], [23.4, 4.6, 11.6], grate);
  for (const [x, z] of [[26.6, 13.1], [24.6, 13.1], [23.4, 12.4]]) box([0.12, 4.6, 0.12], [x, 2.3, z], beam, false);

  // ---- PWR: umbilical held off its socket by clamp K1.
  const latch = createSwingingLatch(scene, new THREE.Vector3(25.6, 9.6, 10.6), new THREE.Vector3(25.6, 1.7, 10.6),
    new THREE.Vector3(23.6, 5.6, 10.6), 0.55, undefined, new THREE.Vector3(-1, 0, 0));
  const kBand = addRustTarget(breakables, rust, 'c5:K1', new THREE.Vector3(23.6, 5.8, 10.6), new THREE.Vector3(0.55, 1, 0.7),
    { tone: 'normal' }, () => {
      latch.release();
      ctx.say('Clamp gone - the plug swings down toward the pedestal.', 3);
    });
  const kClevis = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 16), trim);
  kClevis.position.set(0, -0.65, 0);
  kBand.root.add(kClevis);
  if (ctx.isBroken('c5:K1')) latch.release();
  const pedestalSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('SOCKET PWR', ['UMBILICAL HOME'], 0x9fd8e8) }));
  pedestalSign.position.set(25.6, 1.1, 10.15);
  pedestalSign.rotation.y = Math.PI;
  scene.add(pedestalSign);
  let umbLost = false;

  // ---- SEAL: the collar, the handholds, and six seconds of weather.
  const holds = [
    createHandhold(scene, physics, new THREE.Vector3(30.4, 1.5, 6.4), 1.6),
    createHandhold(scene, physics, new THREE.Vector3(30.4, 1.5, 11.6), 1.6),
  ];
  let flowDone = false;
  const decompression = createDecompression({
    breach: new THREE.Vector3(WIDTH, 2, 9),
    drawRadius: 3.6, flowTime: 7,
    anchored: () => !!ctx.player && holds.some(hold => hold.near(ctx.player!)),
    onEnd: () => {
      flowDone = true;
      if (!latch.latched() && !umbLost) {
        umbLost = true;
        latch.reset();
        ctx.say('Prime: The loose umbilical was sucked into the breach and is gone. Only the terminal puts it back.', 6);
      }
      ctx.say('Air equalises. The collar lamps blink green.', 3);
    },
  });
  const scMat = rust.material('heavy');
  const collar = breakables.add('c5:SC', 'crowbar', new THREE.Vector3(WIDTH - 0.45, 2.3, 9), new THREE.Vector3(0.5, 4.2, 3.4), () => {
    decompression.start();
    ctx.say('Collar breached! Klaxons everywhere. Grab a rail or ride it out.', 4);
  }, {
    hits: 3, material: scMat,
    onDamaged: (_id, hitsLeft) => {
      scMat.uniforms.uDamageStage.value = Math.max(0, 3 - hitsLeft);
      scMat.uniforms.uHitFlash.value = 1.2;
    },
  });
  for (const y of [0.4, 4.2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.12, 8, 24, Math.PI), trim);
    ring.position.set(0, y - 2.3, 0);
    ring.rotation.y = Math.PI / 2;
    collar.root.add(ring);
  }

  // ---- Door lamp cluster: MASS / PWR / SEAL.
  const lampMats = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: 0x30150a, emissive: 0x120805, emissiveIntensity: 1 }));
  lampMats.forEach((mat, index) => {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), mat);
    lamp.position.set(WIDTH - 0.5, 5.2, 7.8 + index * 0.6);
    scene.add(lamp);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12), beam);
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(WIDTH - 0.42, 5.2, 7.8 + index * 0.6);
    scene.add(bezel);
  });
  const lampSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('DOOR X', ['MASS / PWR / SEAL'], 0xff9a4a) }));
  lampSign.position.set(WIDTH - 0.4, 6.1, 9);
  lampSign.rotation.y = -Math.PI / 2;
  scene.add(lampSign);

  // ---- Reward chest niche and bay clutter.
  box([3.4, 0.5, 3.4], [24.4, 0.05, 4.6], rusted);
  for (const [x, z] of [[22.9, 3.1], [25.9, 3.1], [22.9, 6.1], [25.9, 6.1]]) box([0.25, 3.4, 0.25], [x, 1.7, z], beam);
  box([3.4, 0.3, 3.4], [24.4, 3.5, 4.6], rusted, false);
  const nicheLight = new THREE.PointLight(0xffd8a8, 8, 6, 2);
  nicheLight.position.set(24.4, 3.1, 4.6);
  scene.add(nicheLight);
  for (const [x, z, y] of [[12, 12, 0.5], [13, 12, 0.5], [12.5, 12, 1.5], [18, 3.5, 0.5]] as const) {
    box([1, 1, 1], [x, y, z], steelMaterial(0x7a6248));
  }
  addDullDecoy(scene, physics, rust, new THREE.Vector3(14, 0.35, 0.5), new THREE.Vector3(2.6, 0.4, 0.5));
  addDullDecoy(scene, physics, rust, new THREE.Vector3(14, 1.5, 18), new THREE.Vector3(0.6, 3, 3.6));

  // ---- Lore signage and living deck.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.95),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('AIRLOCK 7C-X - GAUNTLET', ['MASS, PWR, SEAL - IN ORDER', 'COLLAR BREACH DRAWS LOOSE GEAR'], 0xff9a4a) }));
  sign.position.set(3.2, 3.6, 0.25);
  scene.add(sign);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('FERRO-BLOOM ADVISORY', ['ORANGE: CROWBAR KINETICS', 'BLUE: SIDEARM BALLISTICS'], 0x4fd6ff) }));
  plaque.position.set(0.25, 2.2, 5);
  plaque.rotation.y = Math.PI / 2;
  scene.add(plaque);
  const fans: THREE.Group[] = [];
  for (const fz of [4, 16]) {
    const unit = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 22), beam);
    unit.add(ring);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.3), steelMaterial(0x77858f));
      blade.position.x = 0.55;
      blade.rotation.x = 0.5;
      const pivot = new THREE.Group();
      pivot.rotation.z = i * Math.PI / 2;
      pivot.add(blade);
      blades.add(pivot);
    }
    unit.add(blades);
    unit.position.set(14, HEIGHT - 0.3, fz);
    unit.rotation.x = Math.PI / 2;
    scene.add(unit);
    fans.push(blades);
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330806, emissive: 0xff3020, emissiveIntensity: 2 });
  const beacons: THREE.Mesh[] = [];
  for (const [bx, by, bz] of [[6.3, 4.4, 6.6], [22.3, 4.4, 6.2], [WIDTH - 0.6, 4.6, 9]]) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), beaconMat);
    beacon.position.set(bx, by, bz);
    scene.add(beacon);
    beacons.push(beacon);
  }
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.07, depthWrite: false });
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3), steamMat);
  steam.position.set(WIDTH - 1.2, 2.2, 9);
  steam.rotation.y = Math.PI / 2;
  scene.add(steam);
  const lamps: THREE.PointLight[] = [];
  for (const at of [[6.4, 2, 8.4], [9, 6.5, 8], [25, 3, 8], [WIDTH - 1.4, 2.6, 9], [14, 9, 12]]) {
    const lamp = new THREE.PointLight(0xff9a52, 14, 17, 2);
    lamp.position.set(at[0], at[1], at[2]);
    scene.add(lamp);
    lamps.push(lamp);
  }
  scene.add(new THREE.HemisphereLight(0x8fa8bd, 0x33281e, 1.7));

  const broken = (id: string) => breakables.objects.some(item => item.id === id && item.broken);
  let greeted = false, hatchSealed = true, clock = 0;
  const route: RouteWaypoint[] = [
    { p: [3.2, 0.4, 3.4], pause: 1.5, caption: '1. Airlock gauntlet. Hatch H0 wears three bloom planks and a chain.' },
    { p: [5.4, 0.4, 8], pause: 2, caption: '2. Crowbar the planks; the chain takes three hits and cracks as it goes.' },
    { p: [9, 0.4, 8], pause: 1.5, caption: '3. Into the bay. The trolley load hangs over the rail - brake first.' },
    { p: [1.6, 0.4, 3], pause: 0.4 },
    { p: [2.2, 4, 6], pause: 0.3 },
    { p: [3.3, 7.6, 10], pause: 0.6 },
    { p: [6.7, 7.6, 8], pause: 2, caption: '4. Balcony spur: three hits on the brake - or pistol the blue sprocket across the trolley.' },
    { p: [20, 0.4, 6.5], pause: 2, caption: '5. The trolley rolls east. Wait under the divider opening, then cut the hang cable as the load passes the plate.' },
    { p: [25, 0.4, 6.5], pause: 2.5 },
    { p: [26.6, 0.9, 12.4], pause: 0.4 },
    { p: [23.4, 4.9, 11.6], pause: 2, caption: '6. Service steps: cut clamp K1. The umbilical swings home into socket PWR.' },
    { p: [30.4, 0.4, 6.4], pause: 2, caption: '7. Grab the handhold rail. Three hits on the seal collar - then hold on for six seconds of weather.' },
    { p: [24.4, 0.4, 4.6], pause: 2.5, caption: '8. Three green lamps. The chest opens - the deck keycard is inside. Door X is out.' },
  ];
  return {
    route,
    spawn: { x: 3.2, y: PHYSICS.playerRadius + 0.15, z: 3.4, yaw: 0 },
    resetTerminal: { x: 0.8, z: 14.6, yaw: Math.PI / 2 },
    previewCamera: { position: new THREE.Vector3(17, 10.5, 1.5), lookAt: new THREE.Vector3(18, 3, 16) },
    bounds: { minX: 0, maxX: WIDTH + 2.5, minZ: 0, maxZ: DEPTH },
    chest: { position: new THREE.Vector3(24.4, 0, 4.6), yaw: Math.PI / 2,
      unlocked: () => seated && latch.latched() && flowDone },
    objective: () => 'CHAMBER 05 - AIRLOCK GAUNTLET: seat the mass, home the umbilical, then breach the collar - in that order. Blue shells are pistol work.',
    update(dt) {
      clock += dt;
      const needsSeal = hatchLocked();
      if (needsSeal !== hatchSealed) {
        hatchSealed = needsSeal;
        hatch.setLocked(needsSeal);
      }
      if (ctx.player) hatch.update(dt, ctx.player, !needsSeal);
      if (trolleyRunning && trolleyX < 24.5) {
        trolleySpeed = Math.min(5.4, trolleySpeed + dt * 0.9);
        trolleyX = Math.min(24.5, trolleyX + trolleySpeed * dt);
      }
      trolley.position.x = trolleyX;
      loadCable.position.set(trolleyX, 5.25, 8);
      if (!loadDropped) {
        load.position.set(trolleyX, 1.75, 8);
        cableBand.root.position.set(trolleyX, 2.2, 8);
        cableBand.body.position.set(trolleyX, 2.2, 8);
        cableBand.body.aabbNeedsUpdate = true;
      } else {
        load.position.copy(loadBody.position as unknown as THREE.Vector3);
        load.quaternion.copy(loadBody.quaternion as unknown as THREE.Quaternion);
        loadCable.visible = false;
        cableBand.root.position.y = -50;
        cableBand.body.position.set(0, -50, 0);
      }
      if (!seated && loadDropped && loadBody.velocity.length() < 0.3) {
        const p = loadBody.position;
        if (Math.hypot(p.x - 25, p.z - 8) < 1.6 && p.y < 1.6) {
          seated = true;
          loadBody.type = CANNON.Body.STATIC;
          loadBody.position.set(25, 0.85, 8);
          loadBody.velocity.setZero();
          loadBody.aabbNeedsUpdate = true;
          ctx.say('Magnetic catch. The mass plate sinks under the load.', 3);
        } else if (p.y < 1) {
          ctx.say('The ballast missed the plate. Pushing two tonnes is not on the menu - the terminal is.', 5);
        }
      }
      plate.update(dt, ctx.player, seated ? [loadBody] : []);
      latch.update(dt);
      if (broken('c5:SC')) decompression.update(dt, ctx.player, world);
      ctx.setExitAllowed(seated && latch.latched() && flowDone);
      lampMats[0].color.setHex(seated ? 0x65ffb6 : 0x30150a);
      lampMats[1].color.setHex(latch.latched() ? 0x65ffb6 : (umbLost ? 0xff4040 : 0x30150a));
      lampMats[2].color.setHex(flowDone ? 0x65ffb6 : 0x30150a);
      for (const blades of fans) blades.rotation.z += dt * 1.4;
      beaconMat.emissiveIntensity = clock % 1.6 < 0.25 ? 3.2 : 0.25;
      lamps[4].intensity = 14 * (0.72 + 0.28 * Math.sin(clock * 11) * Math.sin(clock * 3.7));
      steamMat.opacity = flowDone ? 0.05 : 0.09 + 0.05 * Math.sin(clock * 2);
      if (!greeted && !ctx.preview && ctx.player?.isEnabled()) {
        greeted = true;
        ctx.say('Prime: Last door on the deck. Three lamps over Door X - mass, power, seal - and Donus bloomed every fastener between you and them. Orange to the crowbar, blue to the pistol, and when the collar goes, hold onto a rail. The chest in the lock niche holds the deck keycard.', 14);
      }
    },
    reset() {
      trolleyX = 9; trolleySpeed = 0; trolleyRunning = false; loadDropped = false; seated = false;
      umbLost = false; flowDone = false;
      decompression.reset();
      latch.reset();
      loadBody.type = CANNON.Body.STATIC;
      loadBody.position.set(9, 1.75, 8);
      loadBody.velocity.setZero();
      loadBody.quaternion.set(0, 0, 0, 1);
      loadBody.aabbNeedsUpdate = true;
      loadCable.visible = true;
      chainGroup.visible = true;
      plate.reset();
      hatch.setLocked(true);
    },
  };

  function hatchLocked() {
    return breakables.objects.some(item => /^(c5:P\d|c5:CH)$/.test(item.id) && !item.broken);
  }
}
