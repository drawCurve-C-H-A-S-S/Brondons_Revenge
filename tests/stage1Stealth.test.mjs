import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const storage = await readFile(new URL('../src/scenes/level 1 stage 1/storageRoom.ts', import.meta.url), 'utf8');

test('storage uses scene 3 readable gloom in a tight closet with B quick-hide', () => {
  assert.match(storage, /width: 3\.6, depth: 3\.3, height: 3\.05/);
  assert.match(storage, /BoxGeometry\(STORAGE_CLOSET\.doorWidth, STORAGE_CLOSET\.doorHeight - 0\.04/);
  assert.match(storage, /AmbientLight\(0x445566, 2\.8\)/);
  assert.match(storage, /event\.code === 'KeyB' && peeking/);
  assert.doesNotMatch(storage, /Back to cover \(Q\)|cargoSign/);
});

test('stage owns cinematics, checkpoint retry, impact distractions, and contextual Prime hints', () => {
  assert.match(storage, /position\.x > 14\.85[\s\S]*checkpoint = true/);
  assert.match(storage, /checkpoint \? HANGAR_LAYOUT\.checkpoint/);
  assert.match(storage, /startCinematic\('reveal'\)/);
  assert.match(storage, /startCinematic\('capture'\)/);
  assert.match(storage, /onPistolShot:[\s\S]*director\.emitNoise\(point, 21\)/);
  assert.match(storage, /get ownsWeaponInput\(\)/);
  assert.match(storage, /setHintsEnabled:/);
  assert.match(storage, /event\.code === 'KeyH'/);
  assert.match(storage, /hintTime = 5\.2; hintCooldown = 19/);
  assert.match(storage, /director\.formFiringSquad\(player\.body\.position\);[\s\S]*startCinematic\('alarm'/);
});

test('stealth keeps short interaction effects but no longer synthesizes a continuous siren', () => {
  const setup = storage.slice(storage.indexOf('function ensureAudio()'), storage.indexOf('function ping('));
  assert.doesNotMatch(setup, /createOscillator|createGain/);
  assert.doesNotMatch(storage, /alarmAudio|440 \+ Math\.sin\(alarmAge/);
  assert.match(storage, /function ping[\s\S]*createOscillator/);
});

test('peek actions are centered away from the health and shield bars', async () => {
  const css = await readFile(new URL('../src/styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /#stealth-peek-actions \{ top: 50%; bottom: auto; transform: translate\(-50%, -50%\)/);
});

test('retry control is centered and explicitly names the R key for both checkpoints', async () => {
  const css = await readFile(new URL('../src/styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /#stealth-retry \{ top: 50%; bottom: auto; transform: translate\(-50%, -50%\)/);
  assert.match(storage, /retryButton\.textContent = 'Press R to retry from storage'/);
  assert.match(storage, /retryButton\.textContent = 'Press R to retry from hangar'/);
});

test('scene 1 uses the shared hold-Enter skip and has no instant click handler', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /scene1SkipHold = createHoldToSkip\(/);
  assert.match(main, /scene1SkipHold\?\.update\(delta\)/);
  assert.doesNotMatch(main, /skipBtn\.onclick\s*=\s*\(/);
});

test('prologue and wake-up skip controls share Enter-only progress, pause reset, and cleanup', async () => {
  const prologue = await readFile(new URL('../src/scenes/prologue/prologue_scene_1.ts', import.meta.url), 'utf8');
  const wake = await readFile(new URL('../src/scenes/level 1/scene2.ts', import.meta.url), 'utf8');
  assert.match(prologue, /createHoldToSkip\(\{ button: skipButton, onSkip: finishCutscene/);
  assert.match(prologue, /skipHold\.update\(frame\)/);
  assert.match(prologue, /setMenuPaused:[\s\S]*skipHold\.reset\(\)/);
  assert.match(prologue, /skipHold\.dispose\(\)/);
  assert.doesNotMatch(prologue, /skipPointerHeld|skipKeyHeld|onSkipPointerDown/);
  assert.match(wake, /createHoldToSkip\(\{ button: wakeSkipBtn, onSkip: finishWake/);
  assert.match(wake, /wakeSkipHold\?\.update\(dt\)/);
  assert.doesNotMatch(wake, /wakeSkipBtn\.addEventListener\('click'/);
});

test('hangar has physical cover, container ladders, refuges, no vents, and two working bulkheads', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  let physics;
  try {
    const { createStealthHangar, HANGAR_LAYOUT } = await server.ssrLoadModule('/scenes/level 1 stage 1/stealthHangar.ts');
    const { createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts');
    const THREE = await import('three');
    const CANNON = await import('cannon-es');
    physics = createScenePhysics();
    const scene = new THREE.Scene();
    const hangar = createStealthHangar(scene, physics, 12);
    assert.equal(hangar.ladders.length, 12);
    assert.equal(hangar.rooftops.length, 12);
    assert.equal(hangar.platforms.length, 7);
    assert.equal(hangar.scanSurfaces.length, 19);
    const connected = new Set(['cargo-roof-0']);
    for (let iteration = 0; iteration < hangar.platforms.length; iteration++) for (const platform of hangar.platforms) {
      if (connected.has(platform.from) || connected.has(platform.to)) { connected.add(platform.from); connected.add(platform.to); }
    }
    assert.ok(connected.has('cargo-roof-5'), 'The first catwalk group must carry the player across and along container roofs');
    assert.equal(connected.has('cargo-roof-11'), false, 'The catwalks must not form an uninterrupted entrance-to-exit shortcut');
    assert.ok(hangar.rooftops[6].x - hangar.rooftops[3].x - 8 >= 12, 'The missing central span requires a ground detour');
    for (const platform of hangar.platforms) {
      const hit = new CANNON.RaycastResult(), surface = new THREE.Vector3(0.17, 0.09, 0.21).applyMatrix4(platform.mesh.matrixWorld);
      physics.world.raycastClosest(new CANNON.Vec3(surface.x, surface.y + 1, surface.z),
        new CANNON.Vec3(surface.x, surface.y - 1, surface.z), { checkCollisionResponse: true }, hit);
      assert.equal(hit.body, platform.body, `${platform.id} must have a physical walkable deck`);
      assert.ok(Math.abs(hit.hitPointWorld.y - surface.y) < 0.01);
      assert.ok(hit.hitNormalWorld.y > 0.5);
      assert.ok(Math.atan2(Math.abs(platform.end.y - platform.start.y), Math.hypot(platform.end.x - platform.start.x,
        platform.end.z - platform.start.z)) < Math.PI / 4, 'Sloped links must remain walkable');
    }
    assert.equal(hangar.safeZones.length, 15);
    assert.equal(scene.children.some(object => /^Vent/.test(object.name)), false);
    assert.ok(hangar.obstacles.length >= 20);
    assert.equal(HANGAR_LAYOUT.containers.length, 12);
    assert.ok(scene.getObjectByName('HangarDockedShuttle'));
    for (const name of ['ShuttleHullWithCockpitCutout', 'ShuttleWindshield', 'ShuttleCanopy', 'ShuttlePilotSeat']) {
      assert.ok(hangar.shuttle.getObjectByName(name), `The docked shuttle must reuse the detailed ${name}`);
    }
    const shipBounds = new THREE.Box3().setFromObject(hangar.shuttle);
    assert.ok(shipBounds.max.x < 83 && shipBounds.min.z > 21, 'The improved ship must leave the airlock approach clear');
    assert.ok(scene.getObjectByName('CentralRotatingAlarmBeacon'));
    hangar.updateAlarm(0.2, true);
    const firstSweep = hangar.alarmSpots[0].light.target.position.clone();
    hangar.updateAlarm(0.8, true);
    assert.ok(firstSweep.distanceTo(hangar.alarmSpots[0].light.target.position) > 10);
    assert.ok(hangar.alarmSpots.every(spot => spot.light.visible && spot.light.intensity === 1000));
    hangar.updateAlarm(0.1, false); assert.ok(hangar.alarmSpots.every(spot => !spot.light.visible));
    assert.ok(scene.getObjectByName('HangarRoof').userData.minimap === false);
    assert.ok(hangar.safeZones.some(zone => zone.kind === 'roof' && zone.bounds.containsPoint(new THREE.Vector3(28, 18.7, -15))));
    assert.equal(hangar.entrance.open, 0);
    hangar.entrance.update(1, true);
    assert.equal(hangar.entrance.open, 1);
    assert.ok(hangar.entrance.leaves.every(leaf => Math.abs(leaf.body.position.z + 2.5) > 2));
    hangar.entrance.update(1, false);
    assert.equal(hangar.entrance.open, 0);
    assert.ok(physics.world.bodies.every(body => Number.isFinite(body.position.y)));
    scene.traverse(object => { object.geometry?.dispose(); });
  } finally { physics?.dispose(); await server.close(); }
});

test('stealth patrols respect cover, safe zones, noise, rear takedowns, and swarm routing', async context => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  let physics, director;
  try {
    const THREE = await import('three');
    const { createStealthHangar } = await server.ssrLoadModule('/scenes/level 1 stage 1/stealthHangar.ts');
    const { createStealthDirector } = await server.ssrLoadModule('/scenes/level 1 stage 1/stealthDirector.ts');
    const { createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts');
    physics = createScenePhysics();
    const scene = new THREE.Scene(), hangar = createStealthHangar(scene, physics, 12);
    let alarms = 0;
    director = createStealthDirector(scene, physics, hangar, { onAlarm: () => alarms++, onAttack() {} },
      async () => ({ scene: new THREE.Group(), animations: [] }));
    await director.ready;
    const observe = (x, z, extra = {}) => ({ position: { x, y: 12.3, z }, crouching: true, sprinting: false,
      moving: false, protected: false, enabled: true, ...extra });
    const actor = director.actors[0];

    await context.test('minimap cones use actual facing even across Euler angle wrapping', () => {
      actor.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.75);
      const marker = director.getMinimapEnemies().find(enemy => enemy.id === actor.id);
      assert.ok(Math.abs(marker.yaw + Math.PI / 4) < 1e-6);
    });
    await context.test('cargo occludes sight and elevated roofs stay outside ground patrol vision', () => {
      actor.root.position.set(20, 12, 0); actor.root.rotation.set(0, Math.PI / 2, 0);
      assert.equal(director.canSee(actor, observe(28, 0, { crouching: false })), false);
      actor.root.position.z = -7;
      assert.equal(director.canSee(actor, observe(24, -7)), true);
      assert.equal(director.canSee(actor, observe(24, -7, { protected: true })), false);
      assert.equal(director.safeZoneFor({ x: 28, y: 18.7, z: -15 }), 'cargo-roof-0');
      assert.equal(director.isProtected({ x: 28, y: 18.7, z: -15 }), false, 'Roof safety must not disable occasional eye scans');
      assert.equal(director.canSee(actor, observe(24, -7, { position: { x: 24, y: 16.9, z: -7 } })), false);
    });
    await context.test('only an eye actively sweeping a roof can detect an exposed elevated player', () => {
      const drone = director.actors[10];
      drone.root.position.set(32, 20.6, 0); drone.root.rotation.set(0, -Math.PI / 2, 0);
      const elevated = observe(27.5, 0, { crouching: false, position: { x: 27.5, y: 15.5, z: 0 } });
      drone.scanning = false; assert.equal(director.canSee(drone, elevated), false);
      drone.scanning = true; assert.equal(director.canSee(drone, elevated), true);
      assert.equal(director.canSee(drone, { ...elevated, protected: true }), false);
      drone.scanning = false;
    });
    await context.test('impact noise draws nearby patrols, but repeated identical noise is ignored', () => {
      assert.ok(director.emitNoise({ x: 24, y: 12, z: -7 }, 18) > 0);
      assert.equal(actor.mode, 'investigate');
      assert.equal(actor.target.x, 24);
      assert.equal(director.emitNoise({ x: 24, y: 12, z: -7 }, 18), 0);
      assert.equal(alarms, 0);
    });
    await context.test('only an unaware ground robot can be silently disabled from behind', () => {
      actor.suspicion = 0; actor.root.position.set(20, 12, -7); actor.root.rotation.set(0, Math.PI / 2, 0);
      assert.equal(director.getTakedownCandidate(observe(18.8, -7)), actor);
      assert.notEqual(director.getTakedownCandidate(observe(21.2, -7)), actor);
      actor.suspicion = 0.5;
      assert.notEqual(director.getTakedownCandidate(observe(18.8, -7)), actor);
      actor.suspicion = 0;
      assert.equal(director.completeTakedown(actor.id), true);
      assert.equal(actor.mode, 'down');
      assert.equal(actor.body.collisionResponse, false);
      assert.equal(alarms, 0);
    });
    await context.test('A* keeps the exit and every ladder reachable around physical cargo', () => {
      const entry = { x: 17.4, z: -2.5 };
      for (const destination of [{ x: 84, z: 20 }, ...hangar.ladders]) {
        const path = director.navigation.findPath(entry, destination);
        assert.ok(path.length > 1, `No route to ${destination.x}, ${destination.z}`);
        for (const point of path) assert.equal(hangar.obstacles.some(obstacle =>
          point.x > obstacle.min.x - 0.5 && point.x < obstacle.max.x + 0.5
          && point.z > obstacle.min.z - 0.5 && point.z < obstacle.max.z + 0.5), false);
      }
    });
    await context.test('a gun hit activates all reinforcements and reset restores the checkpoint encounter', () => {
      director.reset();
      const damage = director.getDamageTargets()[0];
      assert.equal(damage.damage(25, 'pistol'), true);
      assert.equal(alarms, 1); assert.equal(director.alarmed, true);
      assert.equal(director.actors.filter(candidate => candidate.mode === 'charge').length, 22);
      director.update(0.1, observe(17.4, -2.5, { protected: true }));
      assert.equal(director.alarmed, true, 'A safe zone cannot undo a committed alarm');
      director.reset();
      assert.equal(director.alarmed, false);
      assert.equal(director.actors.filter(candidate => candidate.mode === 'patrol').length, 14);
      assert.equal(director.actors.filter(candidate => candidate.mode === 'reserve').length, 8);
      assert.equal(director.getDamageTargets().length, 14);
    });
    await context.test('the alarm squad forms an actual ring and fires coordinated visible volleys', () => {
      director.forceAlarm(director.actors[0].id);
      const player = observe(35, -5);
      director.formFiringSquad(player.position);
      assert.equal(director.firingSquad.forming, true);
      assert.ok(director.actors.every(candidate => candidate.formation));
      const formations = director.actors.map(candidate => candidate.formation);
      for (const [index, point] of formations.entries()) {
        assert.ok(Math.hypot(point.x - player.position.x, point.z - player.position.z) >= 3.5);
        assert.ok(formations.slice(index + 1).every(other => point.distanceTo(other) >= 2.1));
      }
      const startingClearance = director.actors.map(candidate => Math.min(2.6, Math.hypot(candidate.root.position.x - player.position.x,
        candidate.root.position.z - player.position.z)));
      for (let frame = 0; frame < 600; frame++) {
        director.update(1 / 60, player);
        assert.ok(director.actors.every((candidate, index) => Math.hypot(candidate.root.position.x - player.position.x,
          candidate.root.position.z - player.position.z) >= (frame > 120 ? 2.6 : startingClearance[index]) - 0.05),
        'Approaching robots must route around the player; close detecting guards must move outward');
      }
      assert.ok(director.firingSquad.arrived >= 8);
      assert.ok(director.fireVolley() >= 4);
      assert.equal(director.firingSquad.firing, true);
      assert.ok(scene.children.some(object => object.name === 'FiringSquadVolley'));
      director.reset(); assert.equal(director.firingSquad.forming, false); assert.equal(director.firingSquad.shots, 0);
    });
  } finally { director?.dispose(); physics?.dispose(); await server.close(); }
});

function stageBrowser() {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  class Element extends EventTarget {
    style = { setProperty() {} }; dataset = {}; textContent = ''; innerHTML = ''; children = []; selectors = new Map();
    classes = new Set(['hidden']);
    classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force = !this.classes.has(name)) => { this.classList[force ? 'add' : 'remove'](name); return force; },
    };
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.append(item); return item; }
    remove() { this.removed = true; }
    setAttribute(name, value) { this[name] = value; }
    closest() { return null; }
    querySelector(selector) { if (!this.selectors.has(selector)) this.selectors.set(selector, new Element()); return this.selectors.get(selector); }
    requestPointerLock() {}
    getContext() { const ctx = new Proxy(function () {}, { get: (_t, prop) => prop === 'width' ? 0 : ctx, apply: () => ctx }); return ctx; }
  }
  const elements = new Map(), body = new Element();
  body.classes.clear();
  globalThis.HTMLElement = Element;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, body, baseURI: 'http://localhost:5173/', pointerLockElement: body,
    getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => new Element(), exitPointerLock() { this.pointerLockElement = null; } });
  return () => Object.assign(globalThis, previous);
}
function stageKey(code, type = 'keydown', release = true) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: false } }); window.dispatchEvent(event);
  if (type === 'keydown' && release) stageKey(code, 'keyup');
}
function advanceStage(data, seconds) { for (let index = 0; index < Math.ceil(seconds * 60); index++) data.updatePhysics(1 / 60); }
function holdEnter(data, seconds = 1.2) {
  stageKey('Enter', 'keydown', false); advanceStage(data, seconds); stageKey('Enter', 'keyup');
}

test('shared cinematic skips require continuous Enter and reset on release, blur, pause, and disposal', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  const restore = stageBrowser(); let hold;
  try {
    const { createHoldToSkip } = await server.ssrLoadModule('/helpers/animation/holdToSkip.ts');
    const button = document.createElement('button'); button.classList.remove('hidden');
    let skipped = 0, paused = false;
    hold = createHoldToSkip({ button, onSkip: () => skipped++, isPaused: () => paused });
    const advance = seconds => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) hold.update(1 / 60); };
    button.dispatchEvent(new Event('click', { cancelable: true }));
    button.dispatchEvent(new Event('pointerdown')); advance(1.5); assert.equal(skipped, 0);
    stageKey('Enter'); advance(1.5); assert.equal(skipped, 0, 'A tap cannot skip');
    stageKey('Enter', 'keydown', false); advance(0.6); stageKey('Enter', 'keyup'); advance(0.8); assert.equal(skipped, 0);
    stageKey('Enter', 'keydown', false); advance(0.6); window.dispatchEvent(new Event('blur')); advance(0.8); assert.equal(skipped, 0);
    stageKey('Enter', 'keydown', false); advance(0.6); paused = true; advance(0.1); paused = false; advance(0.8); assert.equal(skipped, 0);
    stageKey('Enter', 'keydown', false); advance(1.2); assert.equal(skipped, 1);
    advance(2); assert.equal(skipped, 1, 'A completed hold only fires once');
    stageKey('Enter', 'keyup'); hold.dispose(); stageKey('Enter', 'keydown', false); advance(2); assert.equal(skipped, 1);
  } finally { hold?.dispose(); restore(); await server.close(); }
});

test('playable stage connects closet, automatic entry, alarm retry, container roofs, and stage 2', async context => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const THREE = await import('three');
    const { createScene } = await server.ssrLoadModule('/scenes/level 1 stage 1/storageRoom.ts');
    const { HANGAR_LAYOUT } = await server.ssrLoadModule('/scenes/level 1 stage 1/stealthHangar.ts');
    const modelLoader = async () => {
      const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial()));
      return { scene, animations: [] };
    };
    await context.test('storage entry materializes with the shared hologram effect before unlocking control', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, openingEntry: true }); await data.ready;
        assert.equal(data.getStageState().phase, 'arrival'); assert.equal(data.isCinematic(), true);
        assert.equal(data.getHologramTransition().blend, 1); assert.equal(data.getHologramTransition().opacity, 0);
        assert.equal(data.canToggleView(), false); assert.equal(data.ownsWeaponInput, true);
        data.player.setPosition(0, 12.3, 1.1); stageKey('KeyE');
        assert.equal(data.getStageState().phase, 'arrival', 'Peeking must wait for materialization');
        advanceStage(data, 0.9); data.applyCinematicCamera();
        assert.ok(data.getHologramTransition().opacity > 0 && data.getHologramTransition().opacity < 1);
        assert.ok(data.camera.position.x > 0 && data.camera.position.x < 1.2);
        advanceStage(data, 1.2);
        assert.equal(data.getHologramTransition(), null); assert.equal(data.getStageState().phase, 'closet');
        assert.equal(data.canToggleView(), true); assert.equal(data.ownsWeaponInput, false);
        stageKey('KeyE'); assert.equal(data.getStageState().phase, 'peek');
        data.dispose();
        data = createScene({ modelLoader, openingEntry: true, restoreCheckpoint: true }); await data.ready;
        assert.equal(data.getHologramTransition(), null, 'Checkpoint retries must not repeat the arrival');
        assert.equal(data.getStageState().phase, 'hangar');
      } finally { data?.dispose(); restore(); }
    });
    await context.test('E and B control peeking without releasing pointer lock or exposing mouse buttons', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader }); await data.ready;
        data.player.setPosition(0, 12.3, 1.1); stageKey('KeyE');
        assert.equal(data.getStageState().phase, 'peek'); assert.equal(data.ownsWeaponInput, true);
        assert.equal(document.pointerLockElement, document.body, 'Peeking must keep the game mouse locked');
        const actions = document.body.children.find(element => element.id === 'stealth-peek-actions');
        assert.equal(actions.children.length, 2); assert.equal(actions.children[0].children[0].textContent, 'E');
        assert.equal(actions.children[1].children[0].textContent, 'B');
        advanceStage(data, 0.25); stageKey('KeyB');
        assert.equal(data.getStageState().phase, 'closet'); assert.equal(data.ownsWeaponInput, false);
        assert.equal(data.player.body.position.z, 0.9);
        assert.equal(document.pointerLockElement, document.body, 'Returning to cover must preserve pointer lock');
        stageKey('KeyE'); stageKey('KeyE'); advanceStage(data, 0.5);
        assert.equal(data.isCinematic(), false);
        data.setHintsEnabled(false); assert.equal(data.getHintsEnabled(), false);
        data.setHintsEnabled(true); advanceStage(data, 0.6); stageKey('KeyH');
        assert.equal(data.getStageState().hintsEnabled, true);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('the second-row music line works with hints disabled, latches on backtracking, and resets on retry', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true, hintsEnabled: false }); await data.ready;
        const rows = [...new Set(HANGAR_LAYOUT.containers.map(cargo => cargo.x))];
        assert.equal(HANGAR_LAYOUT.musicTriggerX, rows[1], 'The line belongs at the second cargo-row center');
        assert.equal(data.getMusicTrack(), 'stealth-1');
        data.player.setPosition(HANGAR_LAYOUT.musicTriggerX + 1, 20, 32); data.updatePhysics(0);
        assert.equal(data.getMusicTrack(), 'stealth-1', 'Outside the hangar must not trigger the cue');
        data.player.setPosition(HANGAR_LAYOUT.musicTriggerX - 0.01, 12.3, 30); data.updatePhysics(0);
        assert.equal(data.getMusicTrack(), 'stealth-1');
        data.player.setPosition(HANGAR_LAYOUT.musicTriggerX, 12.3, 30); data.updatePhysics(0);
        assert.equal(data.getMusicTrack(), 'stealth-2', 'Crossing the line starts the second track');
        data.player.setPosition(HANGAR_LAYOUT.checkpoint.x, 12.3, HANGAR_LAYOUT.checkpoint.z); data.updatePhysics(0);
        assert.equal(data.getMusicTrack(), 'stealth-2', 'Backtracking must not restore the first track');
        data.stealth.forceAlarm(data.stealth.actors[0].id);
        assert.equal(data.getMusicTrack(), 'stealth-alert', 'Being spotted overrides either stealth track immediately');
        holdEnter(data); stageKey('KeyR');
        assert.equal(data.getMusicTrack(), 'stealth-1', 'A fresh checkpoint attempt starts in the first half');
      } finally { data?.dispose(); restore(); }
    });
    await context.test('the corridor drone kills directly without alerting the hangar and retries from storage', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader }); await data.ready;
        data.player.setPosition(7, 12.3, -2.5); advanceStage(data, 1.2);
        assert.equal(data.getStageState().phase, 'caught');
        assert.equal(data.getMusicTrack(), 'stealth-alert');
        assert.equal(data.player.getHealth(), 0); assert.equal(data.player.isEnabled(), false);
        assert.equal(data.getCinematicPose().clip, 'Death01');
        assert.equal(data.getStageState().alarm, false); assert.equal(data.stealth.alarmed, false);
        assert.equal(data.getStageState().firingSquad.forming, false);
        assert.equal(data.stealth.actors.filter(actor => actor.mode === 'reserve').length, 8);
        assert.equal(data.stealth.actors.some(actor => actor.mode === 'charge'), false);
        assert.equal(document.body.classList.contains('storage-alert'), false);
        assert.equal(data.hangar.alarmSpots.some(spot => spot.light.visible), false);
        const retry = document.body.children.find(element => element.id === 'stealth-retry');
        assert.equal(retry.classList.contains('hidden'), false);
        assert.equal(retry.textContent, 'Press R to retry from storage');
        holdEnter(data);
        assert.ok(data.getCinematicPose().time >= 2.5, 'Holding Enter finishes the short corridor death pose');
        stageKey('KeyR');
        assert.equal(data.getMusicTrack(), 'stealth-1');
        assert.equal(data.player.getHealth(), 100); assert.equal(data.player.isEnabled(), true);
        assert.equal(data.getStageState().phase, 'closet'); assert.equal(data.getStageState().checkpoint, false);
        assert.equal(data.isCinematic(), false); assert.equal(retry.classList.contains('hidden'), true);
        assert.ok(Math.abs(data.player.body.position.z - 2.25) < 0.01);
        data.player.setPosition(0, 12.3, 1.1); stageKey('KeyE'); advanceStage(data, 2);
        assert.equal(data.getStageState().phase, 'peek'); assert.equal(data.player.getHealth(), 100);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('crossing the passage door saves a checkpoint and capture retries there', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader }); await data.ready;
        data.player.setPosition(12.5, 12.3, -2.5); stageKey('KeyE');
        assert.equal(data.getStageState().phase, 'reveal', 'The reveal must start as soon as the door is opened');
        advanceStage(data, 0.7);
        assert.equal(data.hangar.entrance.open, 1);
        assert.equal(data.getCinematicPose().clip, 'Walk_Loop');
        advanceStage(data, 1.8);
        assert.equal(data.getStageState().checkpoint, true); assert.equal(data.getStageState().phase, 'reveal');
        assert.ok(Math.abs(data.player.body.position.x - 17.4) < 0.05);
        advanceStage(data, 0.7); stageKey('KeyE');
        assert.equal(data.getStageState().phase, 'reveal', 'E must not bypass the hold-to-skip requirement');
        holdEnter(data);
        assert.equal(data.getStageState().phase, 'hangar');
        data.onPistolShot(new THREE.Vector3(24, 13.3, -21));
        assert.ok(data.getStageState().distractions > 0, 'A real relay impact starts an investigation');
        data.stealth.forceAlarm(data.stealth.actors[0].id);
        advanceStage(data, 3); assert.equal(data.getStageState().phase, 'alarm'); assert.equal(data.isCinematic(), true);
        data.applyCinematicCamera(); assert.ok(Number.isFinite(data.camera.position.x));
        advanceStage(data, 3.2); assert.equal(data.getStageState().phase, 'capture');
        assert.equal(data.getStageState().firingSquad.forming, true);
        advanceStage(data, 3.8); assert.equal(data.getStageState().volleys, 3);
        assert.ok(data.getStageState().firingSquad.arrived >= 3, 'The closest robots must physically reach the ring before the final volley');
        assert.equal(data.getCinematicPose().clip, 'Death01');
        advanceStage(data, 2.6);
        assert.equal(data.getStageState().phase, 'caught'); assert.equal(data.player.isEnabled(), false);
        assert.equal(data.player.getHealth(), 0);
        stageKey('KeyR');
        assert.equal(data.getStageState().phase, 'hangar'); assert.equal(data.getStageState().alarm, false);
        assert.ok(Math.abs(data.player.body.position.x - 17.4) < 0.01);
        assert.equal(data.player.getHealth(), 100); assert.equal(data.player.isEnabled(), true);
        assert.equal(data.getStageState().introSeen, true);
        assert.equal(document.body.classList.contains('storage-caught'), false);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('holding Enter skips the alarm death sequence straight to retry, without saving the player', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true }); await data.ready;
        data.stealth.forceAlarm(data.stealth.actors[0].id); advanceStage(data, 0.1);
        const skip = document.body.children.find(element => element.id === 'stealth-cinematic-skip');
        assert.equal(skip.classList.contains('hidden'), false);
        skip.dispatchEvent(new Event('click', { cancelable: true })); stageKey('Enter'); advanceStage(data, 0.2);
        assert.equal(data.getStageState().phase, 'alarm', 'Neither clicking nor tapping Enter skips the death sequence');
        holdEnter(data, 0.5); assert.equal(data.getStageState().phase, 'alarm');
        holdEnter(data);
        assert.equal(data.getStageState().phase, 'caught'); assert.equal(data.player.getHealth(), 0);
        assert.equal(data.player.isEnabled(), false); assert.equal(skip.classList.contains('hidden'), true);
        assert.equal(document.body.children.find(element => element.id === 'stealth-retry').textContent, 'Press R to retry from hangar');
        stageKey('KeyR'); assert.equal(data.getStageState().phase, 'hangar'); assert.equal(data.player.getHealth(), 100);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('container ladder uses the climb animation and reaches a freely walkable roof', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true }); await data.ready;
        for (const actor of data.stealth.actors) {
          actor.root.position.set(82, actor.root.position.y, 29); actor.path = []; actor.dwell = 30;
        }
        const ladder = data.hangar.ladders[0];
        data.player.setPosition(ladder.x, 12.3, ladder.z + ladder.side * 0.6); stageKey('KeyE');
        assert.equal(data.player.getState().climbing, true); assert.equal(data.getCinematicPose().clip, 'Ladder_Climb_Loop');
        advanceStage(data, 4.5);
        assert.equal(data.player.getState().ventMode, false); assert.equal(data.player.getState().climbing, false);
        assert.equal(data.getStageState().safeZone, 'cargo-roof-0', JSON.stringify({ position: data.player.body.position, stage: data.getStageState() }));
        assert.equal(data.ownsWeaponInput, false);
        document.pointerLockElement = document.body; document.dispatchEvent(new Event('pointerlockchange'));
        const event = new Event('keydown'); Object.defineProperty(event, 'code', { value: 'KeyW' }); window.dispatchEvent(event);
        advanceStage(data, 1); stageKey('KeyW', 'keyup');
        assert.ok(data.player.body.position.z > ladder.topZ + 1, 'W physically walks freely across the container roof');
        assert.equal(data.getStageState().alarm, false);
        data.player.setPosition(ladder.x, ladder.height + 0.3, ladder.topZ); stageKey('KeyE');
        assert.equal(data.player.getState().climbDirection, -1); advanceStage(data, 4.5);
        assert.equal(data.player.getState().ventMode, false); assert.equal(data.player.getState().climbing, false);
        assert.ok(Math.abs(data.player.body.position.y - 12.3) < 0.06);
        assert.equal(data.ownsWeaponInput, false);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('the player physically walks from one cargo roof across a sloped catwalk to the next', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true }); await data.ready;
        for (const actor of data.stealth.actors) { actor.root.position.set(82, actor.root.position.y, 29); actor.path = []; actor.dwell = 30; }
        data.player.setPosition(30.3, 18.7, -16.45); data.player.setRotation(-Math.PI / 2, 0);
        document.pointerLockElement = document.body; document.dispatchEvent(new Event('pointerlockchange'));
        const event = new Event('keydown'); Object.defineProperty(event, 'code', { value: 'KeyW' }); window.dispatchEvent(event);
        advanceStage(data, 3.2); stageKey('KeyW', 'keyup');
        assert.ok(data.player.body.position.x > 39.5, `Walking must cross the gap: ${JSON.stringify(data.player.body.position)}`);
        assert.ok(data.player.body.position.y > 15.35);
        assert.equal(data.getStageState().safeZone, 'cargo-roof-3');
        assert.equal(data.getStageState().alarm, false);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('all uphill catwalks join the next roof without a jump or collision ledge', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true }); await data.ready;
        for (const actor of data.stealth.actors) actor.mode = 'reserve';
        document.pointerLockElement = document.body; document.dispatchEvent(new Event('pointerlockchange'));
        for (const platform of data.hangar.platforms.filter(platform => Math.abs(platform.start.y - platform.end.y) > 0.1)) {
          const lower = platform.start.y < platform.end.y ? platform.start : platform.end;
          const upper = platform.start.y < platform.end.y ? platform.end : platform.start;
          const heading = upper.clone().sub(lower); heading.y = 0;
          const run = heading.length(); heading.normalize();
          data.player.setPosition(lower.x - heading.x * 0.8, lower.y + data.player.radius, lower.z - heading.z * 0.8);
          data.player.setRotation(Math.atan2(-heading.x, -heading.z), 0); advanceStage(data, 0.2);
          const event = new Event('keydown'); Object.defineProperty(event, 'code', { value: 'KeyW' }); window.dispatchEvent(event);
          advanceStage(data, (run + 1.6) / 4.2 + 0.8); stageKey('KeyW', 'keyup');
          const position = data.player.body.position;
          assert.ok((position.x - upper.x) * heading.x + (position.z - upper.z) * heading.z > 0.1,
            `${platform.id} must walk past the upper roof edge: ${JSON.stringify(position)}`);
          assert.ok(position.y >= upper.y + data.player.radius - 0.06, `${platform.id} must land at upper roof height`);
          assert.equal(data.player.getState().isOnGround, true, `${platform.id} must finish grounded on the next roof`);
        }
      } finally { data?.dispose(); restore(); }
    });
    await context.test('catwalk railings physically stop the player on both sides of every platform', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true }); await data.ready;
        for (const actor of data.stealth.actors) actor.mode = 'reserve';
        document.pointerLockElement = document.body; document.dispatchEvent(new Event('pointerlockchange'));
        for (const platform of data.hangar.platforms) for (const side of [-1, 1]) {
          const localStart = new THREE.Vector3(0.17, 0.45, 0), start = localStart.clone().applyMatrix4(platform.mesh.matrixWorld);
          const across = new THREE.Vector3(0, 0, side).transformDirection(platform.mesh.matrixWorld);
          data.player.setPosition(start.x, start.y, start.z); data.player.setRotation(Math.atan2(-across.x, -across.z), 0);
          advanceStage(data, 0.2);
          const event = new Event('keydown'); Object.defineProperty(event, 'code', { value: 'KeyW' }); window.dispatchEvent(event);
          advanceStage(data, 0.7); stageKey('KeyW', 'keyup');
          const localPosition = new THREE.Vector3().copy(data.player.body.position).applyMatrix4(platform.mesh.matrixWorld.clone().invert());
          assert.ok(side * localPosition.z <= 0.82, `${platform.id} side ${side} must block walking through the railing`);
          assert.ok(data.player.body.position.y > 14.9, 'Rail collision must prevent falling off the elevated walkway');
          assert.equal(platform.railBodies.length, 2);
        }
      } finally { data?.dispose(); restore(); }
    });
    await context.test('takedown animation faces the unaware robot and returns control', async () => {
      const restore = stageBrowser(); let data;
      try {
        data = createScene({ modelLoader, restoreCheckpoint: true }); await data.ready;
        const actor = data.stealth.actors[0]; actor.root.position.set(20, 12, -7); actor.root.rotation.set(0, Math.PI / 2, 0);
        data.player.setPosition(18.8, 12.3, -7); stageKey('KeyE');
        assert.equal(data.getStageState().phase, 'takedown');
        assert.ok(Math.abs(data.player.getState().yaw + Math.PI / 2) < 1e-6);
        assert.equal(data.getCinematicPose().clip, 'Interact');
        advanceStage(data, 1.4);
        assert.equal(data.getStageState().phase, 'hangar'); assert.equal(actor.mode, 'down');
        assert.equal(data.getStageState().alarm, false); assert.equal(data.ownsWeaponInput, false);
        assert.ok(data.player.body.position.x > 19.1);
      } finally { data?.dispose(); restore(); }
    });
    await context.test('far airlock transitions once and alarm prevents its use', async () => {
      const restore = stageBrowser(); let data;
      try {
        let completed = 0;
        data = createScene({ modelLoader, restoreCheckpoint: true, onComplete: () => completed++ }); await data.ready;
        data.player.setPosition(84.4, 18.7, 20); stageKey('KeyE');
        assert.equal(data.getStageState().phase, 'hangar', 'The exit cannot be activated remotely from rooftop height');
        assert.equal(completed, 0);
        data.player.setPosition(84.4, 12.3, 20); stageKey('KeyE'); advanceStage(data, 3.1);
        assert.equal(data.getStageState().phase, 'complete'); assert.equal(completed, 1);
        advanceStage(data, 0.2); assert.equal(completed, 1);
        data.dispose();
        data = createScene({ modelLoader, restoreCheckpoint: true, onComplete: () => completed++ }); await data.ready;
        data.stealth.forceAlarm(data.stealth.actors[0].id); advanceStage(data, 2.6);
        data.player.setPosition(84.4, 12.3, 20); stageKey('KeyE'); advanceStage(data, 0.1);
        assert.equal(data.hangar.exit.open, 0); assert.equal(completed, 1);
        assert.equal(data.getStageState().alarm, true);
      } finally { data?.dispose(); restore(); }
    });
  } finally { await server.close(); }
});