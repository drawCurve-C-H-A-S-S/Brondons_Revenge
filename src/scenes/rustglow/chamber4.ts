import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox } from '../../helpers/scene/shipRoom.js';
import { createShipStatusTexture } from '../../helpers/scene/shipInterior.js';
import { addDullDecoy, addRustTarget, createSwingingLatch,
  panelMaterial, deckPlateMaterial, grateMaterial, rustWallMaterial, steelMaterial, hazardMaterial } from './rustglowKit.js';
import type { ChamberContext, ChamberInstance, RouteWaypoint } from './deck.js';

const WIDTH = 22, DEPTH = 20, HEIGHT = 10, MEZZ = 4, HOLE_Z0 = 8;

export function build(ctx: ChamberContext): ChamberInstance {
  const { scene, physics, world, rust, breakables } = ctx;
  const rusted = rustWallMaterial([8, 4]);
  const rustedTall = rustWallMaterial([10, 5]);
  const deck = deckPlateMaterial([7, 5]);
  const grate = grateMaterial([4, 3]);
  const beam = steelMaterial(0x4e5c6b);
  const trim = steelMaterial(0x8b9dab);
  const box = (size: [number, number, number], at: [number, number, number], mat: THREE.Material = beam, solid = true) =>
    roomBox(scene, physics, size, at, mat, solid);
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 });
  void HOLE_Z0;

  // ---- Shell, and the mezzanine slab over z 8-20 with the lift well cut at x 1.6-4.6, z 8-11.
  box([WIDTH, 0.4, DEPTH], [WIDTH / 2, -0.2, DEPTH / 2], deck);
  box([WIDTH, 0.5, DEPTH], [WIDTH / 2, HEIGHT + 0.25, DEPTH / 2], beam, false);
  box([WIDTH, 1.2, DEPTH - 3], [WIDTH / 2, HEIGHT - 0.6, DEPTH / 2], beam, false);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, -0.2], rustedTall);
  box([WIDTH, HEIGHT, 0.4], [WIDTH / 2, HEIGHT / 2, DEPTH + 0.2], rustedTall);
  box([0.4, HEIGHT, DEPTH], [-0.2, HEIGHT / 2, DEPTH / 2], rustedTall);
  // East wall carries the live door opening at z 7.5-12.5, sill at the mezzanine level.
  box([0.4, HEIGHT, 7.5], [WIDTH + 0.2, HEIGHT / 2, 3.75], rustedTall);
  box([0.4, HEIGHT, DEPTH - 12.5], [WIDTH + 0.2, HEIGHT / 2, (12.5 + DEPTH) / 2], rustedTall);
  box([0.4, MEZZ, 5], [WIDTH + 0.2, MEZZ / 2, 10], rustedTall);
  box([0.4, HEIGHT - MEZZ - 4.4, 5], [WIDTH + 0.2, MEZZ + 4.4 + (HEIGHT - MEZZ - 4.4) / 2, 10], rustedTall);
  box([1.6, 0.4, 3], [0.8, MEZZ + 0.2, 9.5], grate);
  box([WIDTH - 4.6, 0.4, 3], [(4.6 + WIDTH) / 2, MEZZ + 0.2, 9.5], grate);
  box([WIDTH, 0.4, DEPTH - 11], [WIDTH / 2, MEZZ + 0.2, (11 + DEPTH) / 2], deck);
  box([2.2, 1, 0.12], [3.1, MEZZ + 0.7, 10.94], trim, false);
  box([WIDTH - 5, 1, 0.12], [(5 + WIDTH) / 2, MEZZ + 0.7, 8.06], trim, false);
  for (const z of [4, 9, 14, 18]) box([WIDTH - 1, 0.6, 0.4], [WIDTH / 2, HEIGHT - 0.8, z], beam, false);
  for (const [x, z] of [[7, 4], [16, 4], [7, 16], [16, 16]]) {
    if (z < 8) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, HEIGHT, 8), steelMaterial(0x5f6d78));
      pier.position.set(x, HEIGHT / 2, z);
      scene.add(pier);
      physics.addBox({ x: 1.3, y: HEIGHT, z: 1.3 }, { x, y: HEIGHT / 2, z });
    }
  }

  // ---- Freight lift: kinematic car that rises 4 m in two seconds when its lines are alive.
  const liftMesh = new THREE.Group();
  const liftDeck = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.25, 2.8), grate);
  liftDeck.castShadow = true;
  liftMesh.add(liftDeck);
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), beam);
    post.position.set(x, 1.1, z);
    liftMesh.add(post);
  }
  const liftStripe = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.18, 2.82), hazardMaterial());
  liftStripe.position.y = -0.2;
  liftMesh.add(liftStripe);
  liftMesh.position.set(3.1, 0.13, 9.5);
  scene.add(liftMesh);
  const liftCable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, HEIGHT, 6), cableMat);
  liftCable.position.set(3.1, HEIGHT / 2, 9.5);
  scene.add(liftCable);
  const liftBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC });
  liftBody.addShape(new CANNON.Box(new CANNON.Vec3(1.4, 0.125, 1.4)));
  liftBody.position.set(3.1, 0.13, 9.5);
  world.addBody(liftBody);
  let liftY = 0, liftTarget = 0, liftRode = false;

  // ---- Generation, junction and the two floor bands.
  const gen = box([2.4, 1.8, 2.2], [10.8, 0.9, 2.4], rusted, false);
  gen.name = 'c4-generator';
  const genPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('BUS 7C-4', ['FEED A: LIFT + CURTAIN', 'FEED E: CAR MOTOR'], 0xff9a4a) }));
  genPanel.position.set(10.8, 1.3, 1.28);
  genPanel.rotation.y = Math.PI;
  scene.add(genPanel);
  box([1, 1.4, 1], [7, 0.7, 3], rusted, false);
  box([2.2, 0.14, 0.14], [8, 0.12, 3], cableMat, false);
  box([1.8, 0.14, 0.14], [5, 0.12, 3], cableMat, false);
  const aBand = addRustTarget(breakables, rust, 'c4:A', new THREE.Vector3(8, 0.55, 3), new THREE.Vector3(1.6, 0.5, 0.5),
    { tone: 'normal' }, () => {
      ctx.say('Main line down. The lift dies wherever it stands.', 4);
      if (!liftRode) ctx.say('Prime: Nothing upstairs now but the dumbwaiter shelves. And the terminal.', 5);
    });
  const aCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 10, 1, true), trim);
  aCollar.rotation.z = Math.PI / 2;
  aBand.root.add(aCollar);
  const eBand = addRustTarget(breakables, rust, 'c4:E', new THREE.Vector3(5, 0.55, 3), new THREE.Vector3(1.4, 0.5, 0.5),
    { tone: 'normal' }, () => ctx.say('Motor cable cut. The car is dead in the shaft.', 4));
  const eCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 10, 1, true), trim);
  eCollar.rotation.z = Math.PI / 2;
  eBand.root.add(eCollar);

  // ---- Dumbwaiter shelves: the no-power route to the mezzanine.
  box([1.7, 0.22, 1.7], [16.6, 1.42, 17.2], grate);
  box([1.7, 0.22, 1.7], [14.9, 2.86, 18.3], grate);
  for (const [x, z] of [[16, 16.6], [17.2, 17.8], [14.3, 17.7], [15.5, 18.9]]) box([0.12, 2.9, 0.12], [x, 1.45, z], beam, false);

  // ---- Laser curtain across the mezzanine at x 10.5, and its wall bands.
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.45, toneMapped: false });
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.6, DEPTH - 8.6), beamMat);
  curtain.position.set(10.5, MEZZ + 1.9, (8.6 + DEPTH) / 2);
  scene.add(curtain);
  box([0.6, 0.6, 0.6], [10.5, MEZZ + 3.85, DEPTH - 0.5], rusted, false);
  box([0.6, 0.6, 0.6], [10.5, MEZZ + 3.85, 8.9], rusted, false);
  box([3, 0.14, 0.14], [7.5, 5.1, DEPTH - 0.6], cableMat, false);
  const fBand = addRustTarget(breakables, rust, 'c4:F', new THREE.Vector3(7.5, 5.1, DEPTH - 0.75), new THREE.Vector3(1.6, 0.5, 0.5),
    { tone: 'normal' }, () => ctx.say('The red curtain stutters out. The north socket goes dark with it.', 4));
  const fCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10, 1, true), trim);
  fCollar.rotation.z = Math.PI / 2;
  fBand.root.add(fCollar);
  const hBand = addRustTarget(breakables, rust, 'c4:H', new THREE.Vector3(11.6, 7.3, DEPTH - 0.75), new THREE.Vector3(1.4, 0.5, 0.5),
    { tone: 'normal' }, () => ctx.say('Socket feed cut. The curtain still burns - and socket one is dead.', 4));
  const hCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 10, 1, true), trim);
  hCollar.rotation.z = Math.PI / 2;
  hBand.root.add(hCollar);
  // Blue shell on the curtain emitter: shoot it and the curtain dies with socket one still live.
  const lShell = addRustTarget(breakables, rust, 'c4:L1', new THREE.Vector3(10.5, MEZZ + 3.85, DEPTH - 0.5), new THREE.Vector3(0.8, 0.7, 0.8),
    { weapon: 'pistol', tone: 'pistol' }, () => ctx.say('Emitter shell shatters. The curtain dies - socket one never notices.', 4));
  const lHood = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), beam);
  lHood.position.y = 0.5;
  lShell.root.add(lHood);

  // ---- Aux line: clamp K1 holds the plug back; cutting it swings the plug home across the beam.
  const latch = createSwingingLatch(scene, new THREE.Vector3(12, 8.2, 11), new THREE.Vector3(12, 4.7, 11),
    new THREE.Vector3(9.4, 5.4, 11), 0.5, undefined, new THREE.Vector3(-1, 0, 0));
  box([0.7, 0.7, 0.7], [12, 4.35, 11], rusted, false);
  const pedestal = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('SOCKET 2', ['AUX PLUG'], 0x9fd8e8) }));
  pedestal.position.set(12, 4.0, 10.63);
  scene.add(pedestal);
  const kBand = addRustTarget(breakables, rust, 'c4:K1', new THREE.Vector3(9.7, 5.6, 11), new THREE.Vector3(0.5, 0.9, 0.7),
    { tone: 'normal' }, () => {
      latch.release();
      ctx.say('Clamp gone. The plug is swinging for the pedestal socket.', 4);
    });
  const kClevis = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 16), trim);
  kClevis.position.set(0, -0.6, 0);
  kBand.root.add(kClevis);
  if (ctx.isBroken('c4:K1')) latch.release();

  addDullDecoy(scene, physics, rust, new THREE.Vector3(12, 0.8, 6.2), new THREE.Vector3(0.7, 1.6, 2.4), Math.PI / 2);
  breakables.add('c4:d2', 'crowbar', new THREE.Vector3(6, 1.4, 19.5), new THREE.Vector3(1.6, 0.7, 0.5),
    () => ctx.say('Hall lights dip, then sulk back on.', 3),
    { material: rust.material('normal', { scale: 2 }) });

  // ---- Lore signage and living deck.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('POWER INTERLOCK 7C-4', ['CURTAIN AND LOCK SHARE A FEED', 'SEQUENCE BEFORE YOU CUT'], 0xff9a4a) }));
  sign.position.set(6, 3.2, 0.25);
  scene.add(sign);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('FERRO-BLOOM ADVISORY', ['ORANGE: CROWBAR KINETICS', 'BLUE: SIDEARM BALLISTICS'], 0x4fd6ff) }));
  plaque.position.set(0.25, 2.2, 4);
  plaque.rotation.y = Math.PI / 2;
  scene.add(plaque);
  const fans: THREE.Group[] = [];
  for (const fz of [5, 15]) {
    const unit = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.1, 8, 22), beam);
    unit.add(ring);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.28), steelMaterial(0x77858f));
      blade.position.x = 0.5;
      blade.rotation.x = 0.5;
      const pivot = new THREE.Group();
      pivot.rotation.z = i * Math.PI / 2;
      pivot.add(blade);
      blades.add(pivot);
    }
    unit.add(blades);
    unit.position.set(WIDTH - 0.3, 7, fz);
    unit.rotation.y = Math.PI / 2;
    scene.add(unit);
    fans.push(blades);
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330806, emissive: 0xff3020, emissiveIntensity: 2 });
  const beacons: THREE.Mesh[] = [];
  for (const [bx, by, bz] of [[10.5, MEZZ + 4.3, DEPTH - 0.5], [10.5, MEZZ + 4.3, 8.9], [3.1, 0.4, 9.5]]) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), beaconMat);
    beacon.position.set(bx, by, bz);
    scene.add(beacon);
    beacons.push(beacon);
  }
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffb478, transparent: true, opacity: 0.08, depthWrite: false });
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.4), steamMat);
  steam.position.set(10.8, 2.2, 2.4);
  scene.add(steam);
  const lamps: THREE.PointLight[] = [];
  for (const at of [[8, 1, 3], [7.5, 5.2, DEPTH - 1], [9.8, 5.6, 11], [6, 2.5, DEPTH - 0.8], [16, 7, 14]]) {
    const lamp = new THREE.PointLight(0xff9a52, 14, 16, 2);
    lamp.position.set(at[0], at[1], at[2]);
    scene.add(lamp);
    lamps.push(lamp);
  }
  scene.add(new THREE.HemisphereLight(0x8fa8bd, 0x33281e, 1.7));

  const broken = (id: string) => breakables.objects.some(item => item.id === id && item.broken);
  let greeted = false, clock = 0;
  const route: RouteWaypoint[] = [
    { p: [6, 0.4, 2], pause: 1.5, caption: '1. Power interlock 7C-4. The curtain and the east lock share a feed - order matters.' },
    { p: [3.1, 0.5, 9.5], pause: 2, caption: '2. Step on the freight car while bus A and E still breathe. It climbs to the mezzanine.' },
    { p: [3.1, 4.5, 9.5], pause: 1.5 },
    { p: [7, 4.5, 11], pause: 2, caption: '3. Up here: the aux clamp K1 holds the plug back from socket two. Cut it first.' },
    { p: [9.4, 4.6, 11], pause: 2, caption: '4. Plug swings home across the curtain line - socket two now feeds the door.' },
    { p: [7.5, 4.6, 17], pause: 2, caption: '5. Now cut wall band F behind you. The curtain dies; socket one dies with it - but socket two holds the door.' },
    { p: [14, 4.5, 10], pause: 1.5, caption: '6. Cross where the curtain was, out the east door at mezzanine height.' },
    { p: [20, 4.5, 10], pause: 1.5 },
  ];
  return {
    route,
    spawn: { x: 6, y: PHYSICS.playerRadius + 0.15, z: 2, yaw: Math.PI },
    resetTerminal: { x: 1.05, z: 5.4, yaw: Math.PI / 2 },
    exitGate: { frame: { x: WIDTH + 0.3, y: MEZZ, z: 10, yaw: -Math.PI / 2 }, span: 5, height: HEIGHT - MEZZ,
      label: '04 / LIVE WIRE' },
    previewCamera: { position: new THREE.Vector3(11, 9, 1.2), lookAt: new THREE.Vector3(11, 4, 16) },
    bounds: { minX: 0, maxX: WIDTH + 2.5, minZ: 0, maxZ: DEPTH },
    objective: () => 'CHAMBER 04 - LIVE WIRE: one line feeds the door, the same line feeds the curtain. Choose the order. Blue shell on the emitter is pistol work.',
    update(dt) {
      clock += dt;
      const powered = !broken('c4:A') && !broken('c4:E');
      const rider = ctx.player?.isEnabled()
        && Math.abs(ctx.player.body.position.x - 3.1) < 1.6 && Math.abs(ctx.player.body.position.z - 9.5) < 1.6
        && ctx.player.body.position.y < MEZZ + 1.6;
      if (rider && liftY < 0.05 && powered) liftTarget = MEZZ;
      if (liftTarget > liftY) liftY = Math.min(liftTarget, liftY + dt * (MEZZ / 2));
      else if (liftTarget < liftY) liftY = Math.max(liftTarget, liftY - dt * (MEZZ / 2));
      if (liftY >= MEZZ - 0.01) liftRode = true;
      liftBody.position.set(3.1, 0.13 + liftY, 9.5);
      liftBody.aabbNeedsUpdate = true;
      liftMesh.position.y = 0.13 + liftY;
      liftCable.scale.y = Math.max(0.2, (HEIGHT - liftY) / HEIGHT);
      liftCable.position.y = (HEIGHT + liftY) / 2;

      const laserLive = !broken('c4:F') && !broken('c4:A') && !broken('c4:L1');
      if (laserLive && ctx.player?.isEnabled()) {
        const p = ctx.player.body.position;
        if (Math.abs(p.x - 10.5) < 0.5 && p.z > 8.6 && p.y > MEZZ - 0.3 && p.y < MEZZ + 3.8) {
          ctx.player.body.position.set(3.4, MEZZ + 0.8, 9.5);
          ctx.player.body.velocity.setZero();
          ctx.say('The curtain did its job. You did not.', 3);
        }
      }
      curtain.visible = laserLive;
      beamMat.opacity = 0.35 + 0.12 * Math.sin(clock * 4);

      // Door power is live, not latched: socket two home OR socket one path intact.
      ctx.setExitAllowed(latch.latched() || (!broken('c4:A') && !broken('c4:F') && !broken('c4:H')));
      for (const blades of fans) blades.rotation.z += dt * 1.6;
      beaconMat.emissiveIntensity = clock % 1.6 < 0.25 ? 3.2 : 0.25;
      lamps[1].intensity = 14 * (0.72 + 0.28 * Math.sin(clock * 11) * Math.sin(clock * 3.7));
      steamMat.opacity = 0.06 + 0.05 * Math.sin(clock * 2.2);
      if (!greeted && !ctx.preview && ctx.player?.isEnabled()) {
        greeted = true;
        ctx.say('Prime: Power interlock. The red curtain and the east lock drink from the same bus, so cutting blindly strands you. Ride the car up while it still runs, swing the aux plug home, then cut the curtain feed. The blue shell on the emitter is a pistol shortcut - it kills the curtain and leaves socket one breathing. Reset board by the spawn if you sequence yourself into a corner.', 14);
      }
    },
    reset() {
      liftY = 0; liftTarget = 0; liftRode = false;
      liftBody.position.set(3.1, 0.13, 9.5);
      latch.reset();
    },
  };
}
