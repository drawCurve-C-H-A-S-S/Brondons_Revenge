import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let server, THREE, CANNON, GLTFLoader, layout, createStage, createStorage, createHangar, hangarLayout;
let createPhysics, createPlayer, createCctv, createEquipment, keycardJSON, corridorMonitor, droneStrategy;
const rooms = {};
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
      name: 'stage-two-test-deps',
      resolveId: id => id === 'virtual:stage-two-deps' ? '\0stage-two-deps' : null,
      load: id => id === '\0stage-two-deps'
        ? "export * as THREE from 'three'; export * as CANNON from 'cannon-es'; export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';" : null,
    }] });
  ({ THREE, CANNON, GLTFLoader } = await server.ssrLoadModule('virtual:stage-two-deps'));
  layout = await server.ssrLoadModule('/scenes/level 1 stage 2/stageTwoLayout.ts');
  ({ createScene: createStage } = await server.ssrLoadModule('/scenes/level 1 stage 2/scene.ts'));
  ({ createScene: createStorage } = await server.ssrLoadModule('/scenes/level 1 stage 1/storageRoom.ts'));
  ({ createStealthHangar: createHangar, HANGAR_LAYOUT: hangarLayout } = await server.ssrLoadModule('/scenes/level 1 stage 1/stealthHangar.ts'));
  ({ createScenePhysics: createPhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
  ({ createCctvSystem: createCctv } = await server.ssrLoadModule('/scripts/cctv.ts'));
  ({ createScene: createEquipment } = await server.ssrLoadModule('/scenes/level 1 stage 2/equipmentRoom.ts'));
  corridorMonitor = await server.ssrLoadModule('/helpers/scene/corridorMonitor.ts');
  droneStrategy = await server.ssrLoadModule('/scenes/level 1 stage 1/stealthDirector.ts');
  for (const id of [5, 6]) rooms[id] = (await server.ssrLoadModule(`/scenes/level 1/scene${id}.ts`)).createScene;
  const base = new URL('../src/assets/models/Tools/', import.meta.url);
  keycardJSON = JSON.parse(await readFile(new URL('Prop_KeyCard.gltf', base), 'utf8'));
  for (const buffer of keycardJSON.buffers)
    buffer.uri = `data:application/octet-stream;base64,${(await readFile(new URL(buffer.uri, base))).toString('base64')}`;
  delete keycardJSON.materials; delete keycardJSON.textures; delete keycardJSON.images;
  for (const mesh of keycardJSON.meshes) for (const primitive of mesh.primitives) delete primitive.material;
});
after(async () => server?.close());

function browser(t) {
  const previous = Object.fromEntries(['window', 'document', 'HTMLElement', 'ProgressEvent'].map(key => [key, globalThis[key]]));
  const elements = new Map();
  const context = new Proxy({ measureText: text => ({ width: text.length * 14 }),
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) },
    { get: (target, name) => target[name] ?? (() => {}) });
  class Element extends EventTarget {
    constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); }
    style = { setProperty(name, value) { this[name] = value; } };
    dataset = {}; children = []; classes = new Set(); selectors = new Map(); textContent = '';
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force = !this.classes.has(name)) => { this.classList[force ? 'add' : 'remove'](name); return force; },
    };
    append(...nodes) { nodes.forEach(node => { this.children.push(node); node.parent = this; }); }
    appendChild(node) { this.append(node); return node; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    setAttribute(name, value) { this[name] = value; }
    closest(selector) { return selector.split(',').some(tag => tag.trim().toUpperCase() === this.tagName) ? this : null; }
    querySelector(selector) {
      if (!this.selectors.has(selector)) this.selectors.set(selector, new Element(selector === 'img' ? 'img' : 'div'));
      return this.selectors.get(selector);
    }
    getContext() { return context; }
    requestPointerLock() {}
  }
  globalThis.HTMLElement = Element; globalThis.ProgressEvent = class extends Event {};
  const body = new Element('body');
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false }) });
  globalThis.document = Object.assign(new EventTarget(), { body, hidden: false, pointerLockElement: body, baseURI: 'http://localhost:5174/',
    createElement: tag => new Element(tag), getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); } });
  const cleanup = []; t.cleanup = fn => cleanup.push(fn);
  t.after(() => { for (const fn of cleanup.reverse()) fn(); Object.assign(globalThis, previous); });
  return elements;
}
async function modelLoader(name) {
  if (name === 'Prop_KeyCard') return new GLTFLoader().parseAsync(JSON.stringify(keycardJSON), '');
  const scene = new THREE.Group();
  const dimensions = name === 'Prop_Desk_Small' ? [2.4, 0.86, 1.2] : name === 'Prop_Chair' ? [0.6, 1.05, 0.7] : [0.8, 1.7, 0.8];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), new THREE.MeshStandardMaterial()); mesh.position.y = dimensions[1] / 2; scene.add(mesh);
  return { scene, animations: [] };
}
function key(code, type = 'keydown') {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false } }); window.dispatchEvent(event);
}
function tap(code) { key(code); key(code, 'keyup'); }
function step(data, seconds, fps = 60) { for (let i = 0; i < Math.ceil(seconds * fps); i++) data.updatePhysics(1 / fps, true); }
async function stage(t, progress = layout.createStageTwoProgress(), overrides = {}) {
  const data = createStage({ progress, modelLoader, getCameraTarget: () => null, hasReturnMarker: () => true,
    getEquippedWeapon: () => 'unarmed', holsterWeapons() {}, onCrowbarCollected() {}, onRetryFeed() {},
    onCameraTeleport: async () => true, onVentDrop: async () => {}, prepareBay13: async () => {}, onExitToBay13: async () => true,
    onAirlockReturn: async () => true,
    monitorFactory: () => ({ texture: new THREE.Texture(), ready: Promise.resolve(), update() {}, getFrameIndex: () => 0, dispose() {} }),
    ...overrides });
  t.cleanup(() => data.dispose()); await data.ready; return data;
}

function permutations(items) { return items.length ? items.flatMap((item, i) => permutations(items.filter((_value, j) => i !== j)).map(rest => [item, ...rest])) : [[]]; }
for (const order of permutations(['scene5', 'scene6', 'stage2-armory'])) {
  test(`only the final chest keycard works in order ${order.join(' -> ')}`, () => {
    const progress = layout.createStageTwoProgress();
    assert.equal(layout.swipeStageTwoKeycard(progress), 'missing');
    assert.equal(layout.collectStageTwoKeycard(progress, 'stage2-vents'), true);
    assert.equal(layout.swipeStageTwoKeycard(progress), 'rejected');
    order.forEach((id, index) => {
      assert.equal(layout.collectStageTwoKeycard(progress, id), true);
      assert.equal(layout.collectStageTwoKeycard(progress, id), false, 'no duplicate cards on revisits');
      assert.equal(progress.elevatorUnlocked, false, 'collecting a card never opens the door automatically');
      assert.equal(layout.swipeStageTwoKeycard(progress), index === 2 ? 'accepted' : 'rejected');
    });
    assert.deepEqual(progress.keycards, ['stage2-vents', ...order]); assert.equal(progress.acceptedKeycard, order[2]);
    assert.equal(progress.elevatorUnlocked, true);
  });
}

test('large branching maze is connected, has a long solution and places every sensor/checkpoint on floor', () => {
  const { VENT_MAZE: maze, VENT_START: start, VENT_EXIT: exit } = layout;
  assert.equal(maze.length, 25); assert.ok(maze.every(row => row.length === 17));
  const queue = [[start.column, start.row, 0]], seen = new Set([`${start.column},${start.row}`]);
  let distance, junctions = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x, z, steps] = queue[i];
    if (x === exit.column && z === exit.row) distance = steps;
    const next = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]].filter(([nx, nz]) => maze[nz]?.[nx] && maze[nz][nx] !== '#');
    if (next.length > 2) junctions++;
    for (const [nx, nz] of next) if (!seen.has(`${nx},${nz}`)) { seen.add(`${nx},${nz}`); queue.push([nx, nz, steps + 1]); }
  }
  assert.ok(distance >= 100, `maze must not be a short edge shortcut (${distance})`);
  assert.ok(junctions >= 8); assert.equal(seen.size, maze.join('').replaceAll('#', '').length);
  for (const cell of [...layout.VENT_SAFE_CELLS, ...layout.VENT_SENSORS]) assert.ok(seen.has(`${cell.column},${cell.row}`));
  assert.ok(layout.ventPoint(exit.column, exit.row).x === layout.STAGE_TWO.drop.x);
  assert.ok(layout.ventPoint(exit.column, exit.row).z === layout.STAGE_TWO.drop.z);
});

for (const fps of [30, 60, 144]) {
  test(`Shift doubles vent speed while retaining crouch, camera clearance and no jump at ${fps} FPS`, t => {
    browser(t);
    const physics = createPhysics(), camera = new THREE.PerspectiveCamera();
    physics.addBox({ x: 20, y: 0.2, z: 100 }, { x: 0, y: -0.1, z: 0 });
    const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: 0.3, z: 15 } });
    t.cleanup(() => { player.dispose(); physics.dispose(); }); player.enable(); player.setVentMode(true);
    const data = { updatePhysics: dt => physics.step(dt, player) };
    step(data, 0.2, fps); key('KeyW'); const startZ = player.body.position.z; step(data, 1, fps);
    const crawl = startZ - player.body.position.z; assert.ok(Math.abs(crawl - 1.6) < 0.1);
    key('ShiftLeft'); const sprintStart = player.body.position.z; step(data, 1, fps);
    assert.ok(Math.abs(sprintStart - player.body.position.z - crawl * 2) < 0.12);
    assert.equal(player.getState().sprinting, true); assert.equal(player.getState().crouching, true);
    tap('Space'); tap('KeyC'); step(data, 0.2, fps); assert.equal(player.getState().jumping, false); assert.equal(player.getState().sliding, false);
    assert.ok(camera.position.y < 1.05, 'sprinting never stands up in the tunnel');
    key('ShiftLeft', 'keyup'); const slowStart = player.body.position.z; step(data, 1, fps);
    assert.ok(Math.abs(slowStart - player.body.position.z - crawl) < 0.12); assert.equal(player.getState().sprinting, false);
    key('KeyW', 'keyup');
  });
}

test('hangar ladder stays at the far end across from the airlock with a real open ceiling hatch', t => {
  browser(t); const physics = createPhysics(), scene = new THREE.Scene();
  const hangar = createHangar(scene, physics, 12); t.cleanup(() => physics.dispose());
  const ladder = hangar.ladders.find(item => item.id === 'VentAccessLadder');
  assert.ok(ladder.x > 80 && ladder.z < -20); assert.ok(hangarLayout.exit.z > 15);
  assert.equal(ladder.height, 24.125); assert.ok(Math.abs(ladder.topZ - (ladder.z + 0.42)) < 1e-9);
  const hatch = hangarLayout.ventAccess, ray = new CANNON.RaycastResult();
  physics.world.raycastClosest(new CANNON.Vec3(hatch.x, 23.5, hatch.z), new CANNON.Vec3(hatch.x, 24.8, hatch.z), {}, ray);
  assert.equal(ray.hasHit, false, 'the shaft must not be capped by a ceiling or fake platform');
  physics.world.raycastClosest(new CANNON.Vec3(hatch.x + 1.3, 23.5, hatch.z), new CANNON.Vec3(hatch.x + 1.3, 24.8, hatch.z), {}, ray);
  assert.equal(ray.hasHit, true, 'ceiling remains solid around the hatch');
  assert.equal(hangar.ladders.length, 13); assert.ok(scene.getObjectByName('VentCeilingShaft'));
});

test('ceiling climb loops by height, rises without sideward dismount, and transitions exactly once', async t => {
  browser(t); let transfers = 0;
  const data = createStorage({ modelLoader, restoreCheckpoint: true, onComplete: async () => { transfers++; return true; } });
  t.cleanup(() => data.dispose()); await data.ready;
  data.stealth.actors.forEach(actor => { actor.mode = 'reserve'; });
  const ladder = data.hangar.ladders.find(item => item.id === 'VentAccessLadder');
  data.player.setPosition(ladder.x, 12.3, ladder.topZ); tap('KeyE');
  assert.equal(data.isCinematic(), true); assert.equal(data.getCinematicPose().loop, true);
  step(data, 2); const a = data.getCinematicPose().time; const x = data.player.body.position.x, z = data.player.body.position.z;
  step(data, 2); assert.ok(data.getCinematicPose().time > a);
  assert.equal(data.player.body.position.x, x); assert.equal(data.player.body.position.z, z);
  step(data, 12); await Promise.resolve(); assert.equal(transfers, 1);
  assert.ok(data.player.body.position.y >= 24.4); step(data, 1); assert.equal(transfers, 1);
});

test('vent completion drops through a real hole and loads Phase Two exactly once before the guard', async t => {
  browser(t); const progress = layout.createStageTwoProgress(); let loads = 0, release;
  const data = await stage(t, progress, { onVentDrop: () => { loads++; return new Promise(resolve => { release = resolve; }); } });
  assert.equal(data.getStageState().phase, 'maze'); assert.equal(data.player.getState().ventMode, true);
  assert.ok(data.scene.getObjectByName('VentWallTrim')); assert.equal(data.scene.getObjectByName('VentRibs'), undefined);
  data.player.setPosition(layout.STAGE_TWO.ventChest.x - 1.2, 4.3, layout.STAGE_TWO.ventChest.z); tap('KeyE'); step(data, 1);
  assert.equal(data.ventChest.isCollected(), true); assert.deepEqual(progress.keycards, ['stage2-vents']);
  data.player.setPosition(layout.STAGE_TWO.drop.x, 4.3, layout.STAGE_TWO.drop.z); step(data, 1.8);
  assert.equal(loads, 1); assert.equal(data.getStageState().phase, 'hub-loading'); assert.equal(progress.ventCleared, true);
  assert.equal(data.player.isEnabled(), false); step(data, 3); assert.equal(loads, 1);
  release(); await Promise.resolve(); await Promise.resolve();
  assert.equal(data.getStageState().phase, 'guard'); assert.equal(data.player.getState().crouching, true);
  assert.equal(progress.guardDown, false);
});

test('Phase Two loading uses the actual camera-wall screenshot and holds it for at least three seconds', async t => {
  browser(t);
  const previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { callback(0); return 1; };
  t.after(() => { globalThis.requestAnimationFrame = previous; });
  const { createCinematicLoadingScreen } = await server.ssrLoadModule('/helpers/scene/cinematicLoading.ts');
  const screen = createCinematicLoadingScreen(), transition = screen.begin('stage2');
  const root = document.body.children.find(element => element.classList.contains('cinematic-loading'));
  assert.equal(root.dataset.destination, 'stage2');
  assert.equal(root.querySelector('.cinematic-loading-chapter').textContent, 'PHASE 2 / SURVEILLANCE');
  assert.equal(root.querySelector('h1').textContent, 'THE CAMERA HUB');
  assert.match(root.querySelector('img').src, /stage2-camera-wall/);
  root.querySelector('img').onload();
  let presented = false; void transition.presented.then(() => { presented = true; });
  for (let frame = 0; frame < 29; frame++) screen.update(0.1);
  await Promise.resolve(); assert.equal(presented, false);
  screen.update(0.1); await transition.presented; assert.equal(presented, true);
  transition.finish(); assert.equal(screen.active, false); assert.equal(root.classList.contains('hidden'), true);
});

test('door guard blocks camera interactions; silent takedown unlocks the separate crowbar chest', async t => {
  browser(t); const progress = layout.createStageTwoProgress(); progress.checkpoint = 'surveillance'; progress.ventCleared = true;
  let teleports = 0, crowbars = 0;
  const data = await stage(t, progress, { getCameraTarget: () => ({ id: 'scene5', label: 'Cargo hold', status: 'ready' }),
    onCameraTeleport: async () => { teleports++; return true; }, onCrowbarCollected: () => crowbars++ });
  tap('KeyE'); step(data, 1); assert.equal(teleports, 0);
  data.player.setPosition(layout.STAGE_TWO.guard.x, 0.3, layout.STAGE_TWO.guard.z + 1.2); tap('KeyE'); step(data, 2.2);
  assert.equal(progress.guardDown, true); assert.equal(progress.crowbarCollected, false); assert.equal(crowbars, 0);
  assert.equal(data.getStageState().phase, 'surveillance'); assert.equal(data.getDamageTargets().length, 0);
  assert.equal(data.player.getState().climbing, false);
  data.player.setPosition(layout.STAGE_TWO.crowbarChest.x, 0.3, layout.STAGE_TWO.crowbarChest.z - 1.2); tap('KeyE'); step(data, 1);
  assert.equal(progress.crowbarCollected, true); assert.equal(crowbars, 1);
  data.player.setPosition(28, 0.3, -48); tap('KeyE'); step(data, 2); await Promise.resolve();
  assert.equal(teleports, 1);
  assert.equal(data.scene.children.some(item => /Keypad/i.test(item.name)), false);
});

test('a noisy guard attack kills the player and retry preserves vent progress and health', async t => {
  browser(t); const progress = layout.createStageTwoProgress(); progress.checkpoint = 'surveillance'; progress.ventCleared = true;
  const data = await stage(t, progress); data.onPistolShot(); step(data, 1.2);
  assert.equal(data.getStageState().phase, 'failed'); assert.equal(data.player.getHealth(), 0);
  tap('KeyR'); assert.equal(data.getStageState().phase, 'guard'); assert.equal(data.player.getHealth(), 100);
  assert.equal(progress.ventCleared, true); assert.equal(progress.guardDown, false);
});

test('cleared vent and prison feeds never teleport or add keycards when used', async t => {
  browser(t); const progress = layout.createStageTwoProgress(); progress.checkpoint = 'surveillance'; progress.guardDown = true;
  layout.collectStageTwoKeycard(progress, 'stage2-vents'); let transfers = 0, id = 'stage2-prison';
  const data = await stage(t, progress, { getCameraTarget: () => ({ id, label: id, status: 'ready' }),
    onCameraTeleport: async () => { transfers++; return true; } });
  tap('KeyE'); step(data, 2); id = 'stage2-vents'; tap('KeyE'); step(data, 2);
  assert.equal(transfers, 0); assert.equal(data.getStageState().phase, 'surveillance');
  assert.deepEqual(progress.keycards, ['stage2-vents']);
});

test('hub has many desks/computers and a centrally aligned keycard elevator; swipe then walking starts the boss ride', async t => {
  browser(t); const progress = layout.createStageTwoProgress(); progress.checkpoint = 'surveillance'; progress.guardDown = true;
  progress.ventCleared = true; let exits = 0;
  layout.collectStageTwoKeycard(progress, 'stage2-vents');
  for (const id of ['scene5', 'scene6', 'stage2-armory']) layout.collectStageTwoKeycard(progress, id);
  const data = await stage(t, progress, { onExitToBay13: async () => { exits++; return true; } });
  let desks = 0, computers = 0;
  data.scene.traverse(item => { if (/^SurveillanceDesk-/.test(item.name)) desks++; if (/^SurveillanceComputer-/.test(item.name)) computers++; });
  assert.equal(desks, 12); assert.equal(computers, 12);
  const reader = layout.STAGE_TWO.reader, lift = layout.STAGE_TWO.elevator, room = layout.STAGE_TWO.camera;
  assert.equal(lift.x, (room.minX + room.maxX) / 2);
  data.player.setPosition(lift.x, 0.3, room.minZ + 2); tap('KeyE'); step(data, 1.7);
  assert.equal(progress.elevatorUnlocked, true); assert.equal(data.getStageState().phase, 'surveillance'); assert.equal(exits, 0);
  data.player.setPosition(lift.x, 0.3, room.minZ - 0.7); step(data, 1);
  assert.equal(data.getStageState().phase, 'lift-button'); assert.equal(exits, 0);
  data.player.setPosition(lift.x - 1.2, 0.3, lift.z); tap('KeyE'); step(data, 1.8);
  assert.equal(data.getCinematicPose().clip, 'Interact'); step(data, 11);
  await Promise.resolve(); assert.equal(exits, 1); assert.equal(data.getStageState().phase, 'handoff');
  assert.ok(data.scene.getObjectByName('ElevatorKeycardReader').position.distanceTo(new THREE.Vector3(reader.x, reader.y, reader.z)) < 1e-9);
});

for (const id of [5, 6, 37]) {
  test(`minigame ${id} awards the real keycard model even at full health/shield and cannot duplicate it`, async t => {
    browser(t); const progress = layout.createStageTwoProgress(), feedId = id === 37 ? 'stage2-armory' : `scene${id}`;
    const options = { modelLoader, hasReturnMarker: () => true, onRestart: async () => true,
      onKeycardCollected: () => layout.collectStageTwoKeycard(progress, feedId) };
    const data = id === 37 ? createEquipment({ ...options, progress })
      : rooms[id]({ ...options, remoteVisit: true, loot: progress.remoteRooms[feedId] });
    t.cleanup(() => data.dispose()); await data.ready; data.player.addShield(50);
    data.breakables?.objects.forEach(item => item.damage(100, id === 5 ? 'crowbar' : 'pistol'));
    const asset = data.chest.root.getObjectByName('ChestKeycardAsset'); assert.ok(asset);
    assert.ok(new THREE.Box3().setFromObject(asset).getSize(new THREE.Vector3()).length() > 0.3);
    data.player.setPosition(id === 37 ? -2 : 0, 0.3, id === 37 ? -1.3 : id === 5 ? 2.7 : 3.7);
    tap('KeyE'); step(data, 1);
    assert.equal(data.chest.isCollected(), true); assert.deepEqual(progress.keycards, [feedId]);
    assert.equal(progress.remoteRooms[feedId].rewardCollected, true); assert.equal(data.player.getHealth(), 100);
    tap('KeyE'); step(data, 1); assert.deepEqual(progress.keycards, [feedId]);
    if (id === 37) assert.equal(progress.lightsaberCollected, true);
  });
}

test('camera wall has five active feeds and seven off screens; vents and prison are cleared view-only feeds', async t => {
  browser(t); const rendered = [];
  const renderer = { shadowMap: { autoUpdate: true }, getRenderTarget: () => null, setRenderTarget() {}, render: (_scene, camera) => rendered.push(camera) };
  const feedCamera = new THREE.PerspectiveCamera();
  const definitions = [...layout.STAGE_TWO_MINIGAMES, { id: 'stage2-vents', label: 'Vent maze' }, { id: 'stage2-prison', label: 'Prison' }]
    .map(item => ({ ...item, cleared: () => item.id === 'stage2-vents' || item.id === 'stage2-prison',
      load: async () => ({ scene: new THREE.Scene(), camera: feedCamera, dispose() {} }) }));
  const cctv = createCctv(renderer, definitions); t.cleanup(() => cctv.dispose()); await cctv.prepareFeeds();
  const scene = new THREE.Scene(); cctv.update(0.2, scene, true);
  assert.equal(cctv.panel.children.filter(item => /^cctv-screen-/.test(item.name)).length, 5);
  assert.equal(cctv.panel.children.filter(item => /^cctv-standby-/.test(item.name)).length, 7);
  assert.equal(rendered.length, 5); assert.ok(rendered.every(camera => camera === feedCamera));
  const ventScreen = cctv.panel.getObjectByName('cctv-screen-stage2-vents'); scene.updateMatrixWorld(true);
  const targetPoint = ventScreen.getWorldPosition(new THREE.Vector3()), camera = new THREE.PerspectiveCamera();
  camera.position.set(targetPoint.x, targetPoint.y, targetPoint.z - 3); camera.lookAt(targetPoint); camera.updateMatrixWorld(true);
  assert.equal(cctv.getTarget(camera).id, 'stage2-vents'); assert.equal(cctv.getTarget(camera).status, 'ready');
  cctv.detach(); assert.equal(cctv.getTarget(camera), null);
});

test('each desk monitor really advances decoded GIF frames without a playable scene or teleport target', async t => {
  browser(t);
  const buffer = await readFile(new URL('../src/assets/surveillance/corridor-bots-1.gif', import.meta.url));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const clip = corridorMonitor.decodeCorridorGif(bytes);
  assert.equal(clip.frames.length, 24); assert.ok(Math.abs(clip.duration - 2.4) < 1e-8);
  assert.notDeepEqual(clip.frames[0].pixels, clip.frames[6].pixels, 'recorded bots really move between frames');
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  const monitor = corridorMonitor.createCorridorMonitor(0); t.cleanup(() => monitor.dispose()); await monitor.ready;
  assert.equal(monitor.getFrameIndex(), 0); const version = monitor.texture.version;
  monitor.update(0.1); monitor.update(0.1);
  assert.equal(monitor.getFrameIndex(), 2); assert.ok(monitor.texture.version > version);
  for (let i = 0; i < 24; i++) monitor.update(0.1);
  assert.equal(monitor.getFrameIndex(), 2, 'recording loops');
  assert.equal('scene' in monitor, false); assert.equal('camera' in monitor, false);
  monitor.dispose(); monitor.update(0.1); assert.equal(monitor.getFrameIndex(), 2);
});

test('only directly rear pistol shots disable eye drones, with no added perimeter patrols', async t => {
  browser(t); const physics = createPhysics(), scene = new THREE.Scene(), hangar = createHangar(scene, physics, 12);
  let alarms = 0, blocked = 0; const shooter = { x: 33, y: 12.3, z: 0 };
  const director = droneStrategy.createStealthDirector(scene, physics, hangar, {
    getPlayerPosition: () => shooter, onAlarm: () => alarms++, onAttack() {}, onDroneShotBlocked: () => blocked++,
  }, modelLoader);
  t.cleanup(() => { director.dispose(); physics.dispose(); }); await director.ready;
  assert.equal(director.actors.filter(actor => actor.kind === 'eye').length, 4);
  assert.equal(director.actors.filter(actor => actor.mode === 'patrol').length, 14);
  const drone = director.actors.find(actor => actor.kind === 'eye'), target = director.getDamageTargets().find(target => target.root === drone.root);
  drone.root.position.set(30, 15.8, 0); drone.root.rotation.set(0, Math.PI / 2, 0);
  assert.equal(target.damage(25, 'pistol'), false); assert.equal(blocked, 1); assert.equal(alarms, 1); assert.notEqual(drone.mode, 'down');
  director.reset(); drone.root.position.set(30, 15.8, 0); drone.root.rotation.set(0, Math.PI / 2, 0); shooter.x = 27;
  assert.equal(target.damage(25, 'pistol'), true); assert.equal(drone.mode, 'down'); assert.equal(drone.light.visible, false);
  assert.equal(director.alarmed, false); assert.equal(director.consumeSilentDroneShot(), true); assert.equal(director.consumeSilentDroneShot(), false);
});

test('locked airlock gives its two short messages and the cleared hub can be entered through it', async t => {
  const elements = browser(t); let entered = 0;
  const data = createStorage({ modelLoader, restoreCheckpoint: true });
  t.cleanup(() => data.dispose()); await data.ready; data.stealth.actors.forEach(actor => { actor.mode = 'reserve'; });
  data.player.setPosition(84.5, 12.3, 20); tap('KeyE');
  assert.equal(elements.get('boss-subtitles').textContent, 'Door locked.');
  step(data, 1.6); assert.equal(elements.get('boss-subtitles').textContent, 'Prime: We must find another way.');
  data.dispose();
  const linked = createStorage({ modelLoader, restoreCheckpoint: true, airlockUnlocked: true,
    onAirlockEnter: async () => { entered++; return true; } });
  t.cleanup(() => linked.dispose()); await linked.ready; linked.stealth.actors.forEach(actor => { actor.mode = 'reserve'; });
  linked.player.setPosition(84.5, 12.3, 20); tap('KeyE'); await Promise.resolve(); await Promise.resolve();
  assert.equal(entered, 1); assert.equal(linked.getStageState().phase, 'complete');
});

test('silent takedown takes priority over a ladder and freezes every other bot for its short animation', async t => {
  browser(t); const data = createStorage({ modelLoader, restoreCheckpoint: true }); t.cleanup(() => data.dispose()); await data.ready;
  const ladder = data.hangar.ladders[0], actor = data.stealth.actors.find(actor => actor.kind === 'trilobite');
  data.player.setPosition(ladder.x, 12.3, ladder.z + ladder.side * 0.42); data.player.setForcedCrouch(true);
  actor.root.position.set(ladder.x + 1.2, 12, data.player.body.position.z); actor.root.rotation.set(0, Math.PI / 2, 0);
  actor.path = []; actor.dwell = 10; actor.suspicion = 0;
  const positions = data.stealth.actors.filter(other => other !== actor).map(other => other.root.position.clone());
  tap('KeyE'); assert.equal(data.getStageState().phase, 'takedown'); assert.equal(data.getCinematicPose().clip, 'Silent_Takedown');
  step(data, 0.7);
  data.stealth.actors.filter(other => other !== actor).forEach((other, index) => assert.ok(other.root.position.equals(positions[index])));
  assert.equal(data.player.getState().climbing, false); step(data, 1); assert.equal(data.getStageState().phase, 'hangar');
});

test('mounting a ladder from crouch standardizes the pose; holding Space doubles climb travel', async t => {
  browser(t); const data = createStorage({ modelLoader, restoreCheckpoint: true }); t.cleanup(() => data.dispose()); await data.ready;
  data.stealth.actors.forEach(actor => { actor.mode = 'reserve'; });
  const ladder = data.hangar.ladders.find(ladder => ladder.id === 'VentAccessLadder');
  data.player.setPosition(ladder.x, 12.3, ladder.topZ); data.player.setForcedCrouch(true); tap('KeyE'); step(data, 0.5);
  assert.equal(data.player.getState().crouching, false); assert.equal(data.getCinematicPose().loop, true);
  const initial = data.player.body.position.y; step(data, 1); const normal = data.player.body.position.y - initial;
  key('Space'); const fastStart = data.player.body.position.y; step(data, 1); key('Space', 'keyup');
  assert.ok(Math.abs(data.player.body.position.y - fastStart - normal * 2) < 0.03);
  assert.equal(data.player.getState().jumping, false);
});

test('ship map keeps traversal connected and stacks camera-only minigames on surveilled decks', async () => {
  const { createShipMapProgress } = await server.ssrLoadModule('/core/shipMap.ts');
  const { DECK_ONE_MAP } = await server.ssrLoadModule('/scenes/level 1 stage 1/storageRoom.ts');
  const progress = createShipMapProgress(); progress.reveal(DECK_ONE_MAP); progress.reveal(layout.STAGE_TWO_MAP);
  for (const id of [5, 6, 37]) progress.reveal(layout.cameraVisitMap(id));
  progress.reveal(layout.BAY_THIRTEEN_MAP); const map = progress.getLayout();
  assert.equal(map.rooms.some(room => room.id === 33), false, 'old storeroom entrance is gone');
  assert.equal(map.cameraLinks.length, 3);
  for (const id of [5, 6, 37]) {
    assert.equal(map.connections.some(pair => pair.includes(35) && pair.includes(id)), false);
    const remote = map.rooms.find(room => room.id === id), hub = map.rooms.find(room => room.id === 35);
    assert.ok(Math.abs(remote.position.x - hub.position.x) > 25);
    assert.notEqual(remote.position.y, hub.position.y); assert.notEqual(remote.deck, 'main');
    assert.equal(map.playerPoint(id, { x: 0, y: 0.3, z: 0 }).y, remote.position.y + 2.2);
  }
  assert.equal(map.goals.length, 2); assert.equal(map.verticalLinks.length, 2);
  const lift = map.rooms.find(room => room.id === 36), boss = map.rooms.find(room => room.id === 13);
  assert.equal(boss.position.y, lift.position.y - 18);
  assert.ok(map.rooms.find(room => room.id === 34).position.x > map.rooms.find(room => room.id === 31).position.x);
  const hub = map.rooms.find(room => room.id === 35), vents = map.rooms.find(room => room.id === 34);
  assert.ok(Math.abs(hub.position.x - vents.position.x) < 3 && Math.abs(hub.position.z - vents.position.z) < 15);
  assert.ok(map.connections.some(pair => pair.includes(31) && pair.includes(35)), 'airlock connects hangar and camera room');
  assert.equal(map.elevatorRoutes.length, 2); assert.ok(map.elevatorRoutes.every(route => [13, 36].includes(route.id)));
});
