import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, createSlidingPortal } from '../../helpers/scene/shipRoom.js';
import { createShipStatusTexture } from '../../helpers/scene/shipInterior.js';
import { addDullDecoy, addRustTarget, createHandhold, createDecompression,
  panelMaterial, deckPlateMaterial, grateMaterial, rustWallMaterial, steelMaterial, hazardMaterial } from './rustglowKit.js';
import type { ChamberContext, ChamberInstance, RouteWaypoint } from './deck.js';

const WIDTH = 34, DEPTH = 16, HEIGHT = 9;

const LANES = [
  { key: 'HI', panel: new THREE.Vector3(13, 3.45, 12), end: new THREE.Vector3(31.6, 3.4, 12) },
  { key: 'MI', panel: new THREE.Vector3(13, 1.5, 8), end: new THREE.Vector3(29.2, 0.6, 8) },
  { key: 'LO', panel: new THREE.Vector3(13, 1.1, 4.5), end: new THREE.Vector3(26.5, 0.6, 4.5) },
] as const;

export function build(ctx: ChamberContext): ChamberInstance {
  const { scene, physics, world, rust, breakables } = ctx;
  const rusted = rustWallMaterial([8, 4]);
  const rustedTall = rustWallMaterial([12, 5]);
  const deck = deckPlateMaterial([8, 6]);
  const grate = grateMaterial([5, 4]);
  const beam = steelMaterial(0x4e5c6b);
  const trim = steelMaterial(0x8b9dab);
  const box = (size: [number, number, number], at: [number, number, number], mat: THREE.Material = beam, solid = true) =>
    roomBox(scene, physics, size, at, mat, solid);

  // ---- Shell. The breach wall at x 13 carries the three bands; the service lock sits at its south end.
  box([WIDTH, 0.4, DEPTH], [WIDTH / 2, -0.2, DEPTH / 2], deck);
  box([WIDTH, 0.5, DEPTH], [WIDTH / 2, HEIGHT + 0.25, DEPTH / 2], beam, false);
  box([WIDTH, 1.2, DEPTH - 3], [WIDTH / 2, HEIGHT - 0.6, DEPTH / 2], beam, false);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, -0.2], rustedTall);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, DEPTH + 0.2], rustedTall);
  box([0.4, HEIGHT, DEPTH], [-0.2, HEIGHT / 2, DEPTH / 2], rustedTall);
  box([0.4, HEIGHT, 3], [WIDTH + 0.2, HEIGHT / 2, 1.5], rustedTall);
  box([0.4, HEIGHT, DEPTH - 10], [WIDTH + 0.2, HEIGHT / 2, (10 + DEPTH) / 2], rustedTall);
  box([0.4, HEIGHT - 4, 5], [WIDTH + 0.2, 4 + (HEIGHT - 4) / 2, 7.5], rustedTall);
  box([1, HEIGHT, DEPTH - 2.4], [13.5, HEIGHT / 2, 2.4 + (DEPTH - 2.4) / 2], rusted);
  box([1, HEIGHT - 3.4, 2.4], [13.5, 3.4 + (HEIGHT - 3.4) / 2, 1.2], rusted);
  for (const z of [3, 7, 11, 15]) {
    box([WIDTH - 1, 0.6, 0.4], [WIDTH / 2, HEIGHT - 0.8, z], beam, false);
    for (const x of [8, 18, 28]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.28), beam);
      web.position.set(x, HEIGHT - 1.0, z);
      web.rotation.z = x < 18 ? 0.5 : -0.5;
      scene.add(web);
    }
  }
  // Piers break the long box and frame Room B's machinery lanes.
  for (const [x, z] of [[18, 2.6], [30, 2.6], [18, 13.4], [30, 13.4]]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, HEIGHT, 8), steelMaterial(0x5f6d78));
    pier.position.set(x, HEIGHT / 2, z);
    scene.add(pier);
    box([1.6, 0.5, 1.6], [x, 0.25, z], trim);
    physics.addBox({ x: 1.4, y: HEIGHT, z: 1.4 }, { x, y: HEIGHT / 2, z });
  }
  // Coolant run along the north wall with a dull valve.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, WIDTH - 4, 12), steelMaterial(0x5a6a72));
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(WIDTH / 2, 6.4, 0.6);
  scene.add(pipe);
  for (const x of [6, 14, 22, 30]) box([0.6, 0.6, 0.35], [x, 6.4, 0.6], beam, false);
  const valve = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 20), rust.material('dull', { scale: 3 }));
  valve.position.set(26, 6.4, 0.35);
  scene.add(valve);

  // ---- Room A: foam-cube pen, ramp to the wall shelf under the HI band.
  for (const [size, at] of [[[3.2, 0.9, 0.2], [2.6, 0.45, 2.9]], [[0.2, 0.9, 3.2], [0.9, 0.45, 4.5]], [[3.2, 0.9, 0.2], [2.6, 0.45, 6.1]]] as Array<[[number, number, number], [number, number, number]]>) {
    box(size, at, trim);
  }
  const penSign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('FOAM SLUGS', ['1 KG - RIDE THE FLOW'], 0x9fd8e8) }));
  penSign.position.set(2.6, 1.3, 2.78);
  scene.add(penSign);
  const ramp = physics.addStaircase({ width: 2.6, run: 4.6, rise: 2.85, position: { x: 7.5, y: 0, z: 8.4 }, material: grate, yaw: Math.PI / 4 });
  scene.add(ramp.group);
  box([2, 0.3, 5.6], [12, 2.85, 11.8], grate);
  for (const [x, z] of [[11.2, 9.4], [12.8, 9.4], [11.2, 14], [12.8, 14]]) box([0.14, 2.85, 0.14], [x, 1.42, z], beam, false);
  box([2, 0.9, 0.1], [12, 3.4, 9.05], trim, false);

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: panelMaterial([1, 1], { base: '#d8cfa8', seam: '#b3a982', rivet: '#948b6a' }).map ?? undefined, roughness: 0.95 }));
  cube.castShadow = true;
  scene.add(cube);
  const cubeBody = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)) });
  cubeBody.position.set(2.6, 0.6, 4.5);
  cubeBody.angularDamping = 0.6;
  cubeBody.linearDamping = 0.35;
  world.addBody(cubeBody);
  const cubeHome = cubeBody.position.clone();
  const hopperStart = new THREE.Vector3(31.8, 3.3, 12);
  let hopperLoaded = ctx.isBroken('c3:HI');
  let flight: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;

  // ---- Room B: duct runs, hopper, catch net and the waste bin.
  for (const lane of LANES) {
    const span = lane.end.x - 13.6;
    box([span, 1.3, 1.3], [13.6 + span / 2, lane.end.y + 0.8, lane.panel.z], rusted, false);
    for (const x of [18, 24, 30]) {
      if (x < 13.6 + span - 1) box([0.5, 0.5, 0.5], [x, lane.end.y + 0.8, lane.panel.z], beam, false);
    }
  }
  box([2, 1.5, 2], [31.8, 0.75, 12], rusted);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.6, 2.2, 12), trim);
  funnel.position.set(31.8, 2.6, 12);
  scene.add(funnel);
  const hopperSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('HOPPER 31N', ['FEED TO UNLOCK'], 0xff9a4a) }));
  hopperSign.position.set(31.8, 4.2, 10.9);
  scene.add(hopperSign);
  const net = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x88a0b8, roughness: 0.9, wireframe: true }));
  net.position.set(29.9, 1.4, 8);
  scene.add(net);
  box([0.25, 1.2, 3.4], [28.1, 0.6, 4.5], rusted);
  box([0.25, 1.2, 3.4], [24.9, 0.6, 4.5], rusted);
  box([3.4, 1.2, 0.25], [26.5, 0.6, 6.05], rusted);
  const binStripe = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.28), hazardMaterial());
  binStripe.position.set(26.5, 1.25, 6.05);
  scene.add(binStripe);
  const binRamp = physics.addStaircase({ width: 1.6, run: 2.4, rise: 1.2, position: { x: 23.2, y: 0, z: 4.5 }, material: grate, yaw: Math.PI / 2 });
  scene.add(binRamp.group);

  // ---- The drawing that tells you which band is which.
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('MAINT DRAWING 7-C', ['HI BAND -> HOPPER 31N', 'MI BAND -> CATCH NET', 'LO BAND -> WASTE BIN'], 0xff9a4a) }));
  poster.position.set(6.4, 2.1, DEPTH - 0.3);
  poster.rotation.y = Math.PI;
  scene.add(poster);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('FERRO-BLOOM ADVISORY', ['ORANGE: CROWBAR KINETICS', 'BLUE: SIDEARM BALLISTICS'], 0x4fd6ff) }));
  plaque.position.set(0.25, 2.2, 8);
  plaque.rotation.y = Math.PI / 2;
  scene.add(plaque);

  // ---- Handholds beside each band: hold on, or ride the wind into Room B.
  const holds = [
    createHandhold(scene, physics, new THREE.Vector3(11.9, 4.2, 12.9), 1.4),
    createHandhold(scene, physics, new THREE.Vector3(11.9, 1.9, 8.9), 1.4),
    createHandhold(scene, physics, new THREE.Vector3(11.9, 1.9, 4.9), 1.4),
  ];

  const serviceLock = createSlidingPortal(scene, physics, { x: 13, y: 0, z: 1.2, yaw: -Math.PI / 2 }, 3.4, HEIGHT,
    'SERVICE LOCK 7C', { doorHeight: 3.2 });
  serviceLock.setLocked(true);
  let breach: THREE.Vector3 | null = null;
  let flowDone = ctx.isBroken('c3:HI') || ctx.isBroken('c3:MI') || ctx.isBroken('c3:LO');
  const decompression = createDecompression({
    breach: new THREE.Vector3(13, 2, 8),
    drawRadius: 3.4,
    anchored: () => !!ctx.player && holds.some(hold => hold.near(ctx.player!)),
    onEnd: () => {
      flowDone = true;
      serviceLock.setLocked(false);
      if (breach && ctx.player?.isEnabled()
        && Math.hypot(ctx.player.body.position.x - breach.x, ctx.player.body.position.z - breach.z) < 2.6) {
        ctx.player.body.position.set(15.8, 0.7, breach.z);
        ctx.player.body.velocity.setZero();
        ctx.say('Prime: You arrive on the far side. The suit log calls that a landing, not a fall.', 4);
      }
      ctx.say('Flow ended. Service lock 7C unclicks.', 3);
    },
  });
  if (flowDone) serviceLock.setLocked(false);

  function openLane(lane: typeof LANES[number]) {
    breach = lane.panel.clone();
    decompression.setBreach(lane.panel);
    decompression.reset();
    decompression.start();
    serviceLock.setLocked(true);
    flowDone = false;
    const p = cubeBody.position;
    const inDraw = Math.hypot(p.x - lane.panel.x, p.z - lane.panel.z) < 6.5 && p.y < lane.panel.y + 3;
    if (!inDraw) { ctx.say('The band screams open - but whatever it wanted is on the wrong side of the room.', 4); return; }
    if (hopperLoaded) { ctx.say('The hopper path is already occupied.', 3); return; }
    flight = { t: 0, from: new THREE.Vector3(p.x, p.y, p.z), to: lane.end.clone() };
    cubeBody.velocity.setZero();
    cubeBody.angularVelocity.setZero();
    cubeBody.type = CANNON.Body.STATIC;
    cubeBody.aabbNeedsUpdate = true;
  }
  for (const lane of LANES) {
    const band = addRustTarget(breakables, rust, `c3:${lane.key}`, lane.panel, new THREE.Vector3(1.1, lane.key === 'HI' ? 1.4 : 1.2, 1.4),
      { tone: 'normal' }, () => openLane(lane));
    // Duct collar and hazard frame dress the band; parented so the crowbar never self-occludes.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 12, 1, true), steelMaterial(0x6a7883));
    collar.rotation.z = Math.PI / 2;
    collar.position.set(0.5, 0, 0);
    band.root.add(collar);
    for (const y of [-0.75, 0.75]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 1.7), hazardMaterial());
      frame.position.set(0.55, y, 0);
      band.root.add(frame);
    }
  }

  addDullDecoy(scene, physics, rust, new THREE.Vector3(18, 1.4, 15.4), new THREE.Vector3(3.2, 2.8, 0.5));
  breakables.add('c3:d3', 'crowbar', new THREE.Vector3(20, 1.5, 0.45), new THREE.Vector3(0.6, 0.6, 0.6),
    () => ctx.say('A hiss of old coolant. Cosmetic, like most of this deck.', 3),
    { material: rust.material('normal', { scale: 2.4 }) });

  // ---- Living deck: fans, beacons, flicker, breach steam.
  const fans: THREE.Group[] = [];
  for (const [fx, fz, ry] of [[WIDTH - 0.3, 4, Math.PI / 2], [WIDTH - 0.3, 12, Math.PI / 2]]) {
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
    unit.position.set(fx, 6.2, fz);
    unit.rotation.y = ry;
    scene.add(unit);
    fans.push(blades);
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330806, emissive: 0xff3020, emissiveIntensity: 2 });
  const beacons: THREE.Mesh[] = [];
  for (const [bx, by, bz] of [[13.2, 5.6, 1.2], [31.8, 4.6, 12], [13.2, 2.6, 15]]) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), beaconMat);
    beacon.position.set(bx, by, bz);
    scene.add(beacon);
    beacons.push(beacon);
  }
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.08, depthWrite: false });
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), steamMat);
  steam.position.set(14.2, 2, 8);
  steam.rotation.y = Math.PI / 2;
  scene.add(steam);
  const lamps: THREE.PointLight[] = [];
  for (const at of [[6, 8, 8], [20, 7.5, 8], [30, 6, 12], [6, 5, 14]]) {
    const lamp = new THREE.PointLight(at[0] < 13 ? 0xb6dfec : 0xff9a52, 16, 20, 2);
    lamp.position.set(at[0], at[1], at[2]);
    scene.add(lamp);
    lamps.push(lamp);
  }
  scene.add(new THREE.HemisphereLight(0x8fa8bd, 0x33281e, 1.7));

  function feedHopper() {
    hopperLoaded = true;
    cubeBody.type = CANNON.Body.STATIC;
    cubeBody.mass = 0;
    cubeBody.updateMassProperties();
    cubeBody.position.set(hopperStart.x, hopperStart.y, hopperStart.z);
    cubeBody.velocity.setZero();
    cubeBody.aabbNeedsUpdate = true;
    ctx.openExit();
    ctx.say('Hopper fed. The east lock takes the word.', 4);
  }

  let greeted = false, clock = 0;
  if (hopperLoaded) ctx.openExit();
  const route: RouteWaypoint[] = [
    { p: [2.2, 0.4, 1.6], pause: 1.5, caption: '1. Pressure lock 7C. Read the maint drawing on the south wall: HI feeds the hopper.' },
    { p: [2.6, 0.4, 4.5], pause: 1, caption: '2. Nudge a foam slug out of its pen and east along the floor.' },
    { p: [9, 0.4, 9], pause: 1.5, caption: '3. Leave the slug mid-room A, inside the HI band\'s draw.' },
    { p: [10, 1.5, 10.5], pause: 0.3 },
    { p: [12, 3.2, 11.8], pause: 2, caption: '4. Ramp to the wall shelf. Crowbar the HI band - and hold onto something, or ride the flow.' },
    { p: [12, 3.2, 11.8], pause: 2.5 },
    { p: [20, 0.4, 12], pause: 2, caption: '5. The slug rockets the HI duct into hopper 31N. The east lock takes the word.' },
    { p: [31, 0.4, 9], pause: 1.5, caption: '6. Out through the east door. Wrong bands just post your slug to the net or the bin.' },
  ];
  return {
    route,
    spawn: { x: 2.2, y: PHYSICS.playerRadius + 0.15, z: 1.6, yaw: Math.PI },
    resetTerminal: { x: 0.8, z: 13.6, yaw: Math.PI / 2 },
    exitGate: { frame: { x: WIDTH + 0.3, y: 0, z: 7.5, yaw: -Math.PI / 2 }, span: 6, height: HEIGHT, label: '03 / PRESSURE LOCK' },
    previewCamera: { position: new THREE.Vector3(17, 8.2, 1.6), lookAt: new THREE.Vector3(24, 2, 9) },
    bounds: { minX: 0, maxX: WIDTH + 2.5, minZ: 0, maxZ: DEPTH },
    objective: () => 'CHAMBER 03 - PRESSURE LOCK: read the drawing. Only the HI band feeds hopper 31N. Orange to the crowbar.',
    update(dt) {
      clock += dt;
      if (!flight) {
        cube.position.copy(cubeBody.position as unknown as THREE.Vector3);
        cube.quaternion.copy(cubeBody.quaternion as unknown as THREE.Quaternion);
      } else {
        flight.t = Math.min(1, flight.t + dt / 0.9);
        cube.position.copy(flight.from.clone().lerp(flight.to, flight.t));
        if (flight.t >= 1) {
          const arrived = flight.to.clone();
          flight = null;
          cubeBody.type = CANNON.Body.DYNAMIC;
          cubeBody.mass = 1;
          cubeBody.updateMassProperties();
          cubeBody.position.set(arrived.x, arrived.y + 0.4, arrived.z);
          cubeBody.velocity.setZero();
          cubeBody.aabbNeedsUpdate = true;
          if (arrived.distanceTo(LANES[0].end) < 0.9) feedHopper();
          else ctx.say('The foam cube rockets down the duct.', 3);
        }
      }
      if (breach) decompression.update(dt, ctx.player, world);
      if (!hopperLoaded && !flight && cubeBody.type === CANNON.Body.DYNAMIC && ctx.player?.isEnabled()
        && Math.hypot(cubeBody.position.x - 31.8, cubeBody.position.z - 12) < 2 && cubeBody.position.y < 2.4) {
        feedHopper();
      }
      if (ctx.player) serviceLock.update(dt, ctx.player, flowDone && (!breach || decompression.phase() === 'done'));
      for (const blades of fans) blades.rotation.z += dt * 1.6;
      beaconMat.emissiveIntensity = clock % 1.6 < 0.25 ? 3.2 : 0.25;
      lamps[1].intensity = 16 * (0.72 + 0.28 * Math.sin(clock * 11) * Math.sin(clock * 3.7));
      steamMat.opacity = breach ? 0.16 + 0.08 * Math.sin(clock * 6) : 0.05 + 0.03 * Math.sin(clock * 1.3);
      if (!greeted && !ctx.preview && ctx.player?.isEnabled()) {
        greeted = true;
        ctx.say('Prime: Pressure lock 7C. Room B holds vacuum behind that wall, and Donus bloomed the bands shut. The maint drawing says HI feeds the hopper - feed a foam slug to the band, break it, and hold on or ride the flow across. Orange is crowbar work.', 12);
      }
    },
    reset() {
      breach = null; flight = null; flowDone = false; hopperLoaded = false;
      decompression.reset();
      serviceLock.setLocked(true);
      cubeBody.type = CANNON.Body.DYNAMIC;
      cubeBody.mass = 1;
      cubeBody.updateMassProperties();
      cubeBody.position.copy(cubeHome);
      cubeBody.velocity.setZero();
      cubeBody.quaternion.set(0, 0, 0, 1);
      cubeBody.aabbNeedsUpdate = true;
    },
  };
}
