import * as THREE from 'three';
import { PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox } from '../../helpers/scene/shipRoom.js';
import { createShipStatusTexture } from '../../helpers/scene/shipInterior.js';
import { addDullDecoy, addRustTarget, createPushable, syncPushables, returnPushableTo,
  panelMaterial, deckPlateMaterial, grateMaterial, rustWallMaterial, steelMaterial, hazardMaterial } from './rustglowKit.js';
import type { ChamberContext, ChamberInstance, RouteWaypoint } from './deck.js';

const HALL_W = 34, HALL_Z0 = 6, HALL_Z1 = 28, HALL_H = 14;

export function build(ctx: ChamberContext): ChamberInstance {
  const { scene, physics, world, rust, breakables } = ctx;
  const clean = panelMaterial([2, 1]);
  const cleanFloor = deckPlateMaterial([4, 3]);
  const rusted = rustWallMaterial([7, 4]);
  const rustedTall = rustWallMaterial([12, 6]);
  const deck = deckPlateMaterial([9, 7]);
  const grate = grateMaterial([5, 4]);
  const beam = steelMaterial(0x4e5c6b);
  const trim = steelMaterial(0x8b9dab);
  const box = (size: [number, number, number], at: [number, number, number], mat: THREE.Material, solid = true) =>
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

  // ---- Arrival gallery: clean, bright, low. Spawn frame looks straight through the arch at the gate.
  box([10, 0.4, 6], [17, -0.18, 3], cleanFloor);
  box([10, 4.4, 0.4], [17, 2.2, -0.2], clean);
  box([0.4, 4.4, 6], [11.8, 2.2, 3], clean);
  box([0.4, 4.4, 6], [22.2, 2.2, 3], clean);
  box([10, 0.4, 6], [17, 4.6, 3], clean, false);
  for (const x of [12.4, 21.6]) box([0.12, 0.08, 5.2], [x, 4.15, 3], new THREE.MeshStandardMaterial({ color: 0x9fd8e8, emissive: 0x67c3d8, emissiveIntensity: 1.6 }), false);
  const galleryLight = new THREE.PointLight(0xcfeaff, 26, 14, 2);
  galleryLight.position.set(17, 4, 2.6);
  scene.add(galleryLight);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('GATE 7C - COOLANT BAY', ['SEALED FOR TRANSFER', 'AUTH: PUMP CREW ONLY'], 0xff9a4a) }));
  sign.position.set(17, 3.4, HALL_Z0 - 0.32);
  sign.rotation.y = Math.PI;
  scene.add(sign);

  // ---- Pump hall shell: floor plates, walls, and a dropped ceiling spine so the top is not one flat lid.
  box([HALL_W, 0.4, 10.8], [HALL_W / 2, -0.2, 5.4], deck);
  box([HALL_W, 0.4, HALL_Z1 - 17.2], [HALL_W / 2, -0.2, (17.2 + HALL_Z1) / 2], deck);
  box([5.8, 0.4, 6.4], [2.9, -0.2, 14], deck);
  box([17.8, 0.4, 6.4], [25.1, -0.2, 14], deck);
  box([HALL_W, 0.5, HALL_Z1 - HALL_Z0 + 8], [HALL_W / 2, HALL_H + 0.25, (HALL_Z0 + HALL_Z1) / 2 + 2], beam, false);
  box([7, 1.4, HALL_Z1 - HALL_Z0 - 6], [17, HALL_H - 0.7, (HALL_Z0 + HALL_Z1) / 2], beam, false);
  box([0.4, HALL_H, HALL_Z1 - HALL_Z0], [-0.2, HALL_H / 2, (HALL_Z0 + HALL_Z1) / 2], rustedTall);
  box([0.4, HALL_H, HALL_Z1 - HALL_Z0], [HALL_W + 0.2, HALL_H / 2, (HALL_Z0 + HALL_Z1) / 2], rustedTall);
  box([14, HALL_H, 0.5], [7, HALL_H / 2, HALL_Z1], rusted);
  box([14, HALL_H, 0.5], [27, HALL_H / 2, HALL_Z1], rusted);
  box([6, HALL_H - 9.8, 0.5], [17, 9.8 + (HALL_H - 9.8) / 2, HALL_Z1], rusted);
  // South wall of the hall with the 6 m arch at x 14-20.
  box([14, HALL_H, 0.5], [7, HALL_H / 2, HALL_Z0], rusted);
  box([14, HALL_H, 0.5], [27, HALL_H / 2, HALL_Z0], rusted);
  box([6, HALL_H - 5.5, 0.5], [17, 5.5 + (HALL_H - 5.5) / 2, HALL_Z0], rusted);
  box([6.6, 0.5, 1.2], [17, 5.6, HALL_Z0], trim, false);

  // Ceiling trusses: top chord, bottom chord and diagonal webs per rib.
  for (const z of [9, 13, 17, 21, 25]) {
    box([HALL_W - 1, 0.7, 0.45], [HALL_W / 2, HALL_H - 0.9, z], beam, false);
    box([HALL_W - 1, 0.16, 0.9], [HALL_W / 2, HALL_H - 1.35, z], beam, false);
    for (const x of [6, 12, 22, 28]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 0.3), beam);
      web.position.set(x, HALL_H - 1.1, z);
      web.rotation.z = x < 17 ? 0.5 : -0.5;
      scene.add(web);
    }
  }
  for (const x of [4, 30]) box([0.5, 0.9, HALL_Z1 - HALL_Z0 - 2], [x, HALL_H - 1.1, (HALL_Z0 + HALL_Z1) / 2], beam, false);

  // ---- Buttress steps funnel the hall into the gate mouth and seal the flanking pockets.
  // The two pairs under the gantry stop below it so the catwalk stays walkable.
  for (const [x, z] of [[12.75, 27], [21.25, 27], [11.75, 25], [22.25, 25]]) {
    box([0.5, 8.2, 2], [x, 4.1, z], rusted);
    box([0.7, 0.3, 2.2], [x, 8.2, z], trim, false);
  }
  for (const [x, z] of [[10.75, 23], [23.25, 23]]) {
    box([0.5, HALL_H, 2], [x, HALL_H / 2, z], rusted);
    box([0.7, 0.3, 2.2], [x, HALL_H - 0.15, z], trim, false);
  }

  // ---- The gate: corroded plate segments around a pedestrian opening, with two dog arms.
  const gateMat = rust.material('dull', { scale: 0.5 });
  const gatePlates: Array<[readonly [number, number, number], readonly [number, number, number]]> = [
    [[3.2, 9.6, 0.5], [13.5, 4.8, HALL_Z1 - 0.1]],
    [[3.2, 9.6, 0.5], [20.5, 4.8, HALL_Z1 - 0.1]],
    [[3.8, 5.2, 0.5], [17, 7.0, HALL_Z1 - 0.1]],
  ];
  for (const [size, at] of gatePlates) box(size as [number, number, number], at as [number, number, number], gateMat);
  const dogArms = [1.1, 3.3].map(y => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.5), steelMaterial(0x6b5644));
    arm.position.set(17, y, HALL_Z1 - 0.75);
    arm.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.34, 0.54), hazardMaterial());
    band.position.x = -1.1;
    arm.add(band);
    for (const x of [-1.62, 1.62]) {
      const gusset = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.2, 0.62), beam);
      gusset.position.x = x;
      arm.add(gusset);
    }
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.6, 8), trim);
    piston.position.set(1.2, -1.9, 0.4);
    piston.rotation.x = 0.35;
    arm.add(piston);
    scene.add(arm);
    return { mesh: arm, body: physics.addBox({ x: 3.6, y: 2.2, z: 0.5 }, { x: 17, y, z: HALL_Z1 - 0.75 }) };
  });
  const armRaised = [false, false];
  function raiseArm(index: number) {
    if (armRaised[index]) return;
    armRaised[index] = true;
    world.removeBody(dogArms[index].body);
  }

  // ---- L-gantry over the gate + along the west wall, reached by one wide lit stair (29 degrees).
  const stair = physics.addStaircase({ width: 2.6, run: 14.5, rise: 8.6, position: { x: 3.6, y: 0, z: 9.9 }, material: grate, yaw: 0 });
  scene.add(stair.group);
  box([27, 0.35, 3.6], [15.5, 8.42, 26.2], grate);
  box([1.8, 0.35, 10.4], [1.3, 8.42, 20.6], grate);
  for (const [x, z] of [[1.2, 16], [1.2, 22], [8, 27.6], [26, 27.6]]) box([0.4, 8.4, 0.4], [x, 4.2, z], beam);
  box([24, 1.05, 0.12], [17, 9.15, 24.45], trim, false);
  box([0.12, 1.05, 8.4], [2.25, 9.15, 19.6], trim, false);
  box([0.12, 1.05, 2.3], [2.05, 9.15, 26.9], trim, false);
  box([0.12, 1.05, 2.4], [29.0, 9.15, 26.8], trim, false);
  const stairLight = new THREE.PointLight(0xffd8a8, 20, 16, 2);
  stairLight.position.set(4.5, 10.5, 13);
  scene.add(stairLight);
  const gateSpot = new THREE.SpotLight(0xffe2b8, 60, 26, 0.5, 0.45, 1.6);
  gateSpot.position.set(17, 12.6, 20);
  gateSpot.target.position.set(17, 3, HALL_Z1);
  scene.add(gateSpot, gateSpot.target);

  for (const [index, y] of [9.6, 10.35, 11.1].entries()) {
    addRustTarget(breakables, rust, `c1:B${index + 1}`, new THREE.Vector3(17, y, HALL_Z1 - 0.55), new THREE.Vector3(2.8, 0.66, 0.7),
      { tone: 'normal' }, () => {
        const left = [1, 2, 3].filter(bolt => !breakables.objects.some(item => item.id === `c1:B${bolt}` && item.broken)).length;
        if (left > 0) ctx.say(`The upper dog groans. ${left} bolt${left === 1 ? '' : 's'} still in the header.`, 3);
        else { raiseArm(1); ctx.say('Header bolts gone - the upper dog cranks clear. The lower one is chained at the winch alcove.', 5); }
      });
  }

  // ---- Coolant sump: guarded open drain, stair out at its east wall, drop-in anywhere.
  box([10.4, 0.25, 6.4], [11, -3.3, 14], grate);
  box([10.8, 3.4, 0.4], [11, -1.6, 10.8], rusted);
  box([0.4, 3.4, 6.8], [5.8, -1.6, 14], rusted);
  box([0.4, 3.4, 6.8], [16.2, -1.6, 14], rusted);
  const sumpStair = physics.addStaircase({ width: 2.2, run: 4.8, rise: 3.2, position: { x: 14.6, y: -3.2, z: 12.4 }, material: grate, yaw: 0 });
  scene.add(sumpStair.group);
  box([9.4, 0.14, 0.14], [11, 1.05, 10.9], trim, false);
  box([0.14, 0.14, 5.9], [5.9, 1.05, 14], trim, false);
  box([7.0, 0.14, 0.14], [9.9, 1.05, 17.15], trim, false);
  box([0.14, 0.14, 2.2], [16.1, 1.05, 12.2], trim, false);
  for (const x of [7, 10, 13]) box([0.12, 1.05, 0.12], [x, 0.55, 10.9], trim, false);
  for (const x of [8, 11]) box([0.12, 1.05, 0.12], [x, 0.55, 17.15], trim, false);
  const sumpGlow = new THREE.PointLight(0xff7a30, 10, 9, 2);
  sumpGlow.position.set(11, -2.4, 14);
  scene.add(sumpGlow);

  // ---- Coolant tanks: two big vertical volumes so the floor plan is not one open rectangle.
  for (const [tx, tz] of [[7.5, 21], [30.5, 9]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 20), steelMaterial(0x5f6d78));
    tank.position.set(tx, 4, tz);
    tank.castShadow = true;
    scene.add(tank);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steelMaterial(0x6a7883));
    dome.position.set(tx, 8, tz);
    scene.add(dome);
    for (const y of [2.2, 5.8]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(2.03, 0.07, 6, 24), beam);
      strap.position.set(tx, y, tz);
      strap.rotation.x = Math.PI / 2;
      scene.add(strap);
    }
    physics.addBox({ x: 3.6, y: 8, z: 3.6 }, { x: tx, y: 4, z: tz });
    cable(new THREE.Vector3(tx, 7.6, tz), tx < 17
      ? new THREE.Vector3(tx, HALL_H - 1.5, tz)
      : new THREE.Vector3(33.1, 6.6, 12), 0.14);
  }

  // ---- East wall pipe run into a valve.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 15, 12), steelMaterial(0x5a6a72));
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(33.1, 6.6, 16.5);
  scene.add(pipe);
  for (const z of [10, 14, 18, 22]) box([0.7, 0.7, 0.4], [33.1, 6.6, z], beam, false);
  const downPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.6, 12), steelMaterial(0x5a6a72));
  downPipe.position.set(33.1, 3.4, 13);
  scene.add(downPipe);
  const valve = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 20), rust.material('dull', { scale: 3 }));
  valve.position.set(33.1, 1.4, 13);
  scene.add(valve);

  // ---- Winch alcove: open recess in the east wall. Knee wall + bar portcullis, chain glowing inside.
  box([2.6, 4.2, 0.4], [32.6, 2.1, 18.6], rustedTall);
  box([2.6, 4.2, 0.4], [32.6, 2.1, 21.6], rustedTall);
  box([0.4, 4.2, 3.4], [33.6, 2.1, 20.1], rustedTall);
  box([2.6, 0.5, 3.4], [32.6, 4.45, 20.1], rustedTall);
  box([0.35, 1.2, 3.0], [31.45, 0.6, 20.1], rustedTall);
  const portcullis = new THREE.Group();
  const portMat = rust.material('normal', { scale: 1.2 });
  for (const z of [18.8, 19.4, 20.0, 20.6, 21.2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.3, 0.09), portMat);
    bar.position.set(31.45, 2.35, z);
    portcullis.add(bar);
  }
  for (const y of [1.4, 3.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 3.0), beam);
    rail.position.set(31.45, y, 20.1);
    portcullis.add(rail);
  }
  scene.add(portcullis);
  const portItem = breakables.add('c1:G1', 'crowbar', new THREE.Vector3(31.45, 2.35, 20.1), new THREE.Vector3(0.3, 2.3, 3.0), () => {
    portcullis.visible = false;
    ctx.say('The portcullis bars spring loose. Hop the knee wall - the chain is right there.', 4);
  }, {
    material: portMat,
    onDamaged: () => { portMat.uniforms.uHitFlash.value = 1.2; },
  });
  portItem.root.traverse(node => { if (node instanceof THREE.Mesh) node.visible = false; });
  // Parent the visuals to the breakable root so the crowbar never occludes against its own bars.
  portItem.root.add(portcullis);
  portcullis.position.set(-31.45, -2.35, -20.1);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12), beam);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(33.1, 1.1, 18.9);
  scene.add(drum);
  box([1.7, 0.24, 1.7], [30.5, 1.4, 16.6], trim);
  box([1.7, 0.24, 1.7], [30.5, 2.65, 16.6], trim);
  for (const [x, z] of [[29.8, 15.9], [31.2, 15.9], [29.8, 17.3], [31.2, 17.3]]) box([0.14, 2.65, 0.14], [x, 1.32, z], beam, false);
  const chainGroup = new THREE.Group();
  const chainMat = rust.material('heavy');
  for (const [index, linkY] of [3.42, 2.98, 2.54, 2.1, 1.66, 1.22, 0.78].entries()) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.085, 10, 22), chainMat);
    ring.position.set(32.9, linkY, 20.1);
    ring.rotation.y = Math.PI / 2;
    ring.rotation.x = index % 2 ? 1.35 : 0.22;
    ring.castShadow = true;
    chainGroup.add(ring);
  }
  const chainBracket = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 1.2), beam);
  chainBracket.position.set(33.4, 3.9, 20.1);
  chainGroup.add(chainBracket);
  const chainClevis = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.9), beam);
  chainClevis.position.set(32.9, 0.42, 20.1);
  chainGroup.add(chainClevis);
  scene.add(chainGroup);
  const chainItem = breakables.add('c1:H1', 'crowbar', new THREE.Vector3(32.9, 2.0, 20.1), new THREE.Vector3(0.5, 2.9, 1.1), () => {
    chainGroup.visible = false;
    raiseArm(0);
    ctx.say('The chain parts. The lower dog cranks clear.', 4);
  }, {
    hits: 3, material: chainMat,
    onDamaged: (_id, hitsLeft) => {
      chainMat.uniforms.uDamageStage.value = Math.max(0, 3 - hitsLeft);
      chainMat.uniforms.uHitFlash.value = 1.2;
    },
  });
  // The chain links are the visual; hide the plain breakable box under them.
  chainItem.root.traverse(node => { if (node instanceof THREE.Mesh) node.visible = false; });
  chainItem.root.add(chainGroup);
  chainGroup.position.set(-32.9, -2.0, -20.1);
  const alcoveLight = new THREE.PointLight(0xffa050, 3.5, 6, 2);
  alcoveLight.position.set(32.3, 3.0, 20.1);
  scene.add(alcoveLight);

  // ---- Cargo net across the gate mouth, hung from a rust clamp high on the west wall.
  const net = new THREE.Mesh(new THREE.BoxGeometry(7.2, 4.2, 0.35), steelMaterial(0x54636f));
  net.position.set(17, 2.1, HALL_Z1 - 1.5);
  net.castShadow = true;
  scene.add(net);
  const netLattice = new THREE.Mesh(new THREE.BoxGeometry(7.24, 4.22, 0.37), new THREE.MeshBasicMaterial({ color: 0x0c1218, wireframe: true }));
  net.add(netLattice);
  for (const rot of [0.42, -0.42]) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.42, 0.16), steelMaterial(0x6b5644));
    cross.position.z = -0.26;
    cross.rotation.z = rot;
    net.add(cross);
  }
  const netSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('7C SEALED', ['DO NOT SLING'], 0xffd24a) }));
  netSign.position.set(0, 0.6, -0.24);
  netSign.rotation.y = Math.PI;
  net.add(netSign);
  for (const [rx, rz, s] of [[14.2, 26.2, 0.5], [19.8, 26.4, 0.42], [17.4, 26.1, 0.6]]) {
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(s * 2, s, s * 1.4), rust.material('dull', { scale: 2 }));
    chunk.position.set(rx, s / 2, rz);
    chunk.rotation.y = rx;
    scene.add(chunk);
  }
  const netBody = physics.addBox({ x: 7.2, y: 4.2, z: 0.35 }, { x: 17, y: 2.1, z: HALL_Z1 - 1.5 });
  // Blue ceramic-shelled bloom: pistol-only, hung high on the east wall where no climb reaches.
  const clampMat = rust.material('pistol', { scale: 1.1 });
  const pc1 = breakables.add('c1:PC1', 'pistol', new THREE.Vector3(33.1, 10.5, 20.1), new THREE.Vector3(0.8, 1.3, 1.7), () => {
    net.position.y = -60;
    world.removeBody(netBody);
    ctx.say('The clamp shatters. The cargo net crashes down by the gate.', 3);
  }, {
    material: clampMat,
    onDamaged: () => { clampMat.uniforms.uHitFlash.value = 1.2; },
  });
  // The glowing root box is the clamp core and the pistol hit surface; jaws and plate dress it.
  const clampPlate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.7, 2.0), beam);
  clampPlate.position.set(0.62, 0.2, 0);
  pc1.root.add(clampPlate);
  const jawTop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 1.6), clampMat);
  jawTop.position.set(-0.03, 0.5, 0);
  jawTop.rotation.z = -0.16;
  pc1.root.add(jawTop);
  const jawBottom = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 1.6), clampMat);
  jawBottom.position.set(-0.03, -0.45, 0);
  jawBottom.rotation.z = 0.16;
  pc1.root.add(jawBottom);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 18), trim);
  shackle.position.set(-0.4, -0.65, 0);
  shackle.rotation.y = Math.PI / 2;
  pc1.root.add(shackle);
  cable(new THREE.Vector3(32.7, 9.85, 20.1), new THREE.Vector3(20.4, 4.2, HALL_Z1 - 1.5), 0.06);
  cable(new THREE.Vector3(33.1, 6.6, 20.1), new THREE.Vector3(33.1, 10.2, 20.1), 0.09);
  const clampLight = new THREE.PointLight(0x6fd8ff, 7, 9, 2);
  clampLight.position.set(32.2, 10.5, 20.1);
  scene.add(clampLight);

  // ---- Ferro-bloom advisory plaque: the in-world tutorial for crowbar-vs-pistol rust.
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.6),
    new THREE.MeshBasicMaterial({ map: createShipStatusTexture('FERRO-BLOOM ADVISORY', ['ORANGE: CROWBAR KINETICS', 'BLUE: SIDEARM BALLISTICS', 'RE-GROWTH: RESET BOARDS'], 0x4fd6ff) }));
  plaque.position.set(22.0, 2.5, 3.6);
  plaque.rotation.y = -Math.PI / 2;
  scene.add(plaque);

  // ---- Stores crate and teaching decoys.
  const crateMat = new THREE.MeshStandardMaterial({ map: panelMaterial([1, 1], { base: '#7a6248', seam: '#5c4634', rivet: '#4a3826' }).map ?? undefined, roughness: 0.85 });
  const crate = createPushable(scene, world, new THREE.Vector3(24.5, 0.7, 12.5), new THREE.Vector3(1.4, 1.4, 1.4), 20, crateMat);
  const props = [crate];
  addDullDecoy(scene, physics, rust, new THREE.Vector3(0.4, 2.3, 15), new THREE.Vector3(0.45, 4.6, 2.8));
  addDullDecoy(scene, physics, rust, new THREE.Vector3(26.5, 0.55, 8.6), new THREE.Vector3(3.6, 0.5, 0.6), 0.18);
  breakables.add('c1:d2', 'crowbar', new THREE.Vector3(0.5, 1.3, 18.4), new THREE.Vector3(0.5, 0.5, 1.5),
    () => ctx.say('A jet of old coolant hisses and dies. Cosmetic, like most of this deck.', 3),
    { material: rust.material('normal', { scale: 2.2 }) });
  const d2Bracket = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.18), beam);
  d2Bracket.position.set(0.28, 1.3, 18.4);
  scene.add(d2Bracket);

  // ---- Living deck: exhaust fans, beacons, steam, swaying drops, one faulty lamp.
  const fans: THREE.Group[] = [];
  for (const [fx, fy, fz, fr] of [[24, 6.5, HALL_Z1 - 0.2, 1.6], [6, 5, HALL_Z0 + 0.2, 1.1]]) {
    const unit = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(fr, 0.14, 8, 24), beam);
    unit.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 10), trim);
    hub.rotation.x = Math.PI / 2;
    unit.add(hub);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(fr * 0.85, 0.06, 0.4), steelMaterial(0x77858f));
      blade.position.x = fr * 0.5;
      blade.rotation.x = 0.5;
      const pivot = new THREE.Group();
      pivot.rotation.z = i * Math.PI / 2;
      pivot.add(blade);
      blades.add(pivot);
    }
    unit.add(blades);
    unit.position.set(fx, fy, fz);
    scene.add(unit);
    fans.push(blades);
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330806, emissive: 0xff3020, emissiveIntensity: 2 });
  const beacons: THREE.Mesh[] = [];
  for (const [bx, by, bz] of [[13, 5.9, HALL_Z1 - 0.4], [21, 5.9, HALL_Z1 - 0.4], [3.85, 9.4, 16]]) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), beaconMat);
    beacon.position.set(bx, by, bz);
    scene.add(beacon);
    beacons.push(beacon);
  }
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffb478, transparent: true, opacity: 0.1, depthWrite: false });
  const steam: THREE.Mesh[] = [];
  for (const [sx, sy, sz, ry] of [[6.1, 1.3, 14, Math.PI / 2], [16, 1.0, 12.2, 0]]) {
    const puff = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), steamMat);
    puff.position.set(sx, sy, sz);
    puff.rotation.y = ry;
    scene.add(puff);
    steam.push(puff);
  }
  const sways: THREE.Group[] = [];
  for (const [sx, sz] of [[12, 15], [22, 19]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, HALL_H - 1.4, sz);
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), cableMat);
    drop.position.y = -1.5;
    pivot.add(drop);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), trim);
    nozzle.position.y = -3.05;
    nozzle.rotation.x = Math.PI;
    pivot.add(nozzle);
    scene.add(pivot);
    sways.push(pivot);
  }

  scene.add(new THREE.HemisphereLight(0x8fa8bd, 0x33281e, 1.9));
  const hallKey = new THREE.DirectionalLight(0xd8e6f2, 1.2);
  hallKey.position.set(-0.3, 1, -0.4);
  scene.add(hallKey);
  const hallLamps: THREE.PointLight[] = [];
  for (const at of [[17, 12, 8], [8, 12, 20], [26, 12, 20]]) {
    const lamp = new THREE.PointLight(0xff9a52, 14, 17, 2);
    lamp.position.set(at[0], at[1], at[2]);
    scene.add(lamp);
    hallLamps.push(lamp);
  }

  let greeted = false;
  let clock = 0;
  const route: RouteWaypoint[] = [
    { p: [17, 0.4, 2.2], pause: 1.5, caption: '1. Through the arch into the pump hall.' },
    { p: [17, 0.4, 11], pause: 0.4 },
    { p: [9, 0.4, 9.5], pause: 0.6, caption: '2. The wide stair climbs to the gantry over the gate.' },
    { p: [3.6, 3, 14], pause: 0.2 },
    { p: [3.6, 7, 20], pause: 0.2 },
    { p: [3.6, 9.1, 25], pause: 0.6 },
    { p: [9, 9.1, 26.8], pause: 2.2, caption: '3. Break the three rust bolts in the gate header. The upper dog arm releases.' },
    { p: [4, 9.1, 24], pause: 0.3 },
    { p: [3.6, 5, 15], pause: 0.2 },
    { p: [5, 0.4, 9.5], pause: 0.6, caption: '4. Down again. The winch alcove is across the hall, east - the chain glows behind its bars.' },
    { p: [24, 0.4, 13], pause: 0.4 },
    { p: [29.5, 0.4, 18], pause: 2, caption: '5. Crowbar the portcullis bars, then hop the knee wall into the alcove.' },
    { p: [30.8, 0.4, 20.1], pause: 1.2 },
    { p: [32.4, 0.5, 20.1], pause: 2, caption: '6. Hit the heavy chain three times. Watch it crack.' },
    { p: [30, 0.4, 22.5], pause: 0.4, caption: '7. Lower dog free. But the cargo net still seals the gate mouth.' },
    { p: [17, 0.4, 20], pause: 0.4 },
    { p: [24, 0.4, 20], pause: 2.2, caption: '8. Look up east: the net hangs from a blue-shelled clamp ten metres up the wall. Pistol it - crowbars glance off ceramic.' },
    { p: [17, 0.4, 24], pause: 1.2, caption: '9. Gate clear. Walk out - the pump halls are beyond.' },
    { p: [17, 0.4, 27.6], pause: 0.5 },
  ];
  return {
    route,
    spawn: { x: 17, y: PHYSICS.playerRadius + 0.15, z: 2.2, yaw: Math.PI },
    resetTerminal: { x: 20.9, z: 1.9, yaw: -Math.PI / 2 },
    exitGate: { frame: { x: 17, y: 0, z: HALL_Z1 + 0.55, yaw: Math.PI }, span: 8, height: HALL_H, label: '01 / CORROSION GATE' },
    previewCamera: { position: new THREE.Vector3(17, 3.2, 1.5), lookAt: new THREE.Vector3(17, 5, 26) },
    bounds: { minX: 0, maxX: HALL_W, minZ: 0, maxZ: HALL_Z1 + 3 },
    objective: () => 'CHAMBER 01 - CORROSION GATE: orange bloom to the crowbar, blue shell to the pistol. Three header bolts, one alcove chain, one high clamp.',
    update(dt) {
      clock += dt;
      syncPushables(props);
      const isGone = (id: string) => breakables.objects.some(item => item.id === id && item.broken);
      portcullis.visible = !isGone('c1:G1');
      chainGroup.visible = !isGone('c1:H1');
      for (const [index, arm] of dogArms.entries()) {
        if (armRaised[index] && arm.mesh.position.y < 9.6) arm.mesh.position.y = Math.min(9.6, arm.mesh.position.y + dt * 1.4);
      }
      for (const blades of fans) blades.rotation.z += dt * 1.7;
      beaconMat.emissiveIntensity = clock % 1.6 < 0.25 ? 3.2 : 0.25;
      hallLamps[1].intensity = 14 * (0.72 + 0.28 * Math.sin(clock * 11) * Math.sin(clock * 3.7));
      steamMat.opacity = 0.07 + 0.05 * Math.sin(clock * 1.3);
      sumpGlow.intensity = 10 + 2.5 * Math.sin(clock * 2.1);
      for (const [i, pivot] of sways.entries()) pivot.rotation.x = Math.sin(clock * 0.6 + i * 2.1) * 0.05;
      const boltsGone = [1, 2, 3].every(bolt => breakables.objects.some(item => item.id === `c1:B${bolt}` && item.broken));
      const chainGone = breakables.objects.some(item => item.id === 'c1:H1' && item.broken);
      if (boltsGone && chainGone && !ctx.exitOpen()) {
        ctx.openExit();
        ctx.say('Dogs clear. The gate can breathe.', 3);
      }
      if (!greeted && !ctx.preview && ctx.player?.isEnabled()) {
        greeted = true;
        ctx.say('Prime: Gate 7C is dogged shut, and Donus owns the gate firmware - so we do this by hand. Read the plaque by the arch: orange bloom shatters under the crowbar, blue ceramic shell only under bullets. Bolts in the header, chain in the winch alcove east, net on a blue clamp high up. And Brondon - the drops do not hurt anymore.', 12);
      }
    },
    reset() {
      portcullis.visible = true;
      chainGroup.visible = true;
      returnPushableTo(crate, new THREE.Vector3(24.5, 0.7, 12.5));
      net.position.set(17, 2.1, HALL_Z1 - 1.5);
      if (netBody.world !== world) world.addBody(netBody);
      dogArms.forEach((arm, index) => {
        armRaised[index] = false;
        arm.mesh.position.y = [1.1, 3.3][index];
        if (arm.body.world !== world) world.addBody(arm.body);
      });
    },
  };
}
