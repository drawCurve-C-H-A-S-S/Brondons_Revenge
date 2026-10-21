import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { access, readdir } from 'node:fs/promises';
import { createServer } from 'vite';

let server, createGameMusic, finaleMusicTrack, MUSIC_URLS, MUSIC_CROSSFADE_SECONDS, AudioManager, setAudioMenuPaused, setAudioVolume;
const original = { window: globalThis.window, Audio: globalThis.Audio };
class TestAudio extends EventTarget {
  static instances = [];
  static nextFailure = null;
  paused = true; ended = false; currentTime = 0; volume = 1; loop = false; playCount = 0;
  constructor(src) { super(); this.src = src; TestAudio.instances.push(this); }
  load() {}
  pause() { this.paused = true; }
  play() {
    this.playCount++;
    const failure = TestAudio.nextFailure; TestAudio.nextFailure = null;
    if (failure) return Promise.reject(failure);
    this.paused = false; this.ended = false;
    return Promise.resolve();
  }
  finish() { this.paused = true; this.ended = true; this.dispatchEvent(new Event('ended')); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const latest = track => TestAudio.instances.findLast(audio => audio.src === MUSIC_URLS[track]);
const playing = () => TestAudio.instances.filter(audio => !audio.paused && !audio.ended);
function fixture(t) { const music = createGameMusic(); t.after(() => music.dispose()); return music; }

before(async () => {
  globalThis.window = new EventTarget(); globalThis.Audio = TestAudio;
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createGameMusic, finaleMusicTrack, MUSIC_URLS, MUSIC_CROSSFADE_SECONDS } = await server.ssrLoadModule('/helpers/audio/gameMusic.ts'));
  ({ AudioManager, setAudioMenuPaused, setAudioVolume } = await server.ssrLoadModule('/helpers/audio/AudioManager.js'));
});
beforeEach(() => {
  setAudioMenuPaused(false); setAudioVolume('bgm', 1); setAudioVolume('sfx', 1);
  TestAudio.instances = []; TestAudio.nextFailure = null;
});
after(async () => { await server?.close(); Object.assign(globalThis, original); });

test('the soundtrack manifest resolves the exact supplied music files, including the separate credits track', async () => {
  const names = {
    loading: 'Loading.ogg', prologue: 'Prologue less mashing .ogg', 'living-quarters': 'Living quarters.ogg', menu: 'Menu.ogg',
    'stealth-1': 'Stealth1.ogg', 'stealth-2': 'Stealth1 2.ogg', 'stealth-alert': 'Stealth1 3.ogg',
    tension: 'Tension.ogg', puzzle: 'Puzzle_.ogg', boss: 'Some boss_.ogg',
    ship: 'DonRevBGM1.ogg', 'final-battle': 'Final battle.ogg', 'level-2': 'DonRevLevel2.ogg', 'level-2-boss': 'DonRevLevel2Boss.ogg',
    planet: 'Planetbfm.ogg', 'broken-chains': 'BrokenChainsBGm.ogg', credits: 'Level 2.ogg',
  };
  assert.deepEqual(Object.keys(MUSIC_URLS).sort(), Object.keys(names).sort());
  for (const [track, name] of Object.entries(names)) {
    assert.equal(decodeURIComponent(MUSIC_URLS[track]).split('/').at(-1), name);
    await access(new URL(`../src/assets/bgm/${name}`, import.meta.url));
  }
  assert.notEqual(MUSIC_URLS.credits, MUSIC_URLS['level-2']);
  assert.deepEqual((await readdir(new URL('../src/assets/bgm/', import.meta.url))).filter(file => file.endsWith('.m4a')), [],
    'Only the OGG soundtrack ships');
  const { SFX_URLS } = await server.ssrLoadModule('/helpers/audio/sfx.ts');
  assert.equal(decodeURIComponent(SFX_URLS.chest).split('/').at(-1), 'chest.ogg');
  await access(new URL('../src/assets/sounds/chest.ogg', import.meta.url));
});

test('scene entry selects the requested loops and the new planet soundtrack', async t => {
  const music = fixture(t);
  for (const [id, track] of [
    ['scene1', 'loading'], ['prologue1', 'prologue'], ['living-quarters', 'living-quarters'],
    ['stage1-storage', 'stealth-1'], ['scene5', 'puzzle'], ['scene6', 'puzzle'], ['scene13', 'boss'], ['scene14', 'ship'],
    ['scene15', 'level-2'], ['scene16', 'level-2'], ['scene17', 'planet'], ['scene20', 'stealth-2'],
  ]) {
    music.enterScene(id, {}); await flush();
    music.update(MUSIC_CROSSFADE_SECONDS);
    assert.deepEqual(playing(), [latest(track)], id);
    assert.equal(latest(track).loop, true, id);
    assert.equal(latest(track).volume, track === 'level-2' ? 0.45 : 0.5, id);
  }
  music.enterScene('scene2', {}); await flush();
  assert.deepEqual(playing(), []);
});

test('pause music overrides gameplay, stays uninterrupted across submenus, and resumes the exact gameplay position', async t => {
  const music = fixture(t);
  music.enterScene('stage1-storage', { getMusicTrack: () => 'stealth-2' }); await flush();
  const gameplay = latest('stealth-2'); gameplay.currentTime = 9.4;
  setAudioMenuPaused(true); music.setMenuOpen(true); music.setPaused(true); await flush();
  const menu = latest('menu'); menu.currentTime = 5;
  assert.deepEqual(playing(), [menu]);
  assert.equal(gameplay.currentTime, 9.4);
  music.setMenuOpen(true); await flush();
  assert.equal(latest('menu'), menu); assert.equal(menu.currentTime, 5);
  setAudioVolume('sfx', 0); assert.equal(menu.volume, 0.5);
  setAudioVolume('bgm', 0.4); assert.equal(menu.volume, 0.2);
  music.setMenuOpen(false); setAudioMenuPaused(false); music.setPaused(false); await flush();
  assert.deepEqual(playing(), [gameplay]);
  assert.equal(gameplay.currentTime, 9.4); assert.equal(gameplay.volume, 0.2);
});

test('weapon-wheel and local flight pauses suspend music without starting the menu track', async t => {
  const music = fixture(t);
  music.enterScene('scene15', {}); await flush();
  const flight = latest('level-2'); flight.currentTime = 14;
  music.setPaused(true);
  assert.deepEqual(playing(), []); assert.equal(latest('menu'), undefined);
  music.enterScene('scene16', { getMusicTrack: () => 'level-2-boss' }); await flush();
  assert.deepEqual(playing(), [], 'Scene preparation cannot start music during a local pause');
  music.setPaused(false); await flush();
  assert.deepEqual(playing(), [latest('level-2-boss')]);
});

test('scene music cues change immediately and reset correctly for a new attempt', async t => {
  const music = fixture(t);
  let track = 'stealth-1';
  const stage = { getMusicTrack: () => track };
  music.enterScene('stage1-storage', stage); await flush();
  for (const next of ['stealth-2', 'stealth-alert', 'stealth-1']) {
    track = next; music.update(0); await flush();
    music.update(MUSIC_CROSSFADE_SECONDS);
    assert.deepEqual(playing(), [latest(next)]);
  }
  music.enterScene('scene15', { getMusicTrack: () => 'level-2-boss' }); await flush();
  music.update(MUSIC_CROSSFADE_SECONDS);
  assert.deepEqual(playing(), [latest('level-2-boss')]);
  music.enterScene('scene16', { getMusicTrack: () => 'level-2-boss' }); await flush();
  assert.equal(TestAudio.instances.filter(audio => audio.src === MUSIC_URLS['level-2-boss']).length, 1);
  music.enterScene('scene15', { getMusicTrack: () => 'level-2' }); await flush();
  music.update(MUSIC_CROSSFADE_SECONDS);
  assert.deepEqual(playing(), [latest('level-2')]);
});

test('boss victory leaves the current soundtrack playing without restarting or overriding it', async t => {
  const music = fixture(t); let won = false;
  const bossScene = { hasBossVictory: () => won };
  music.enterScene('scene13', bossScene); await flush();
  const boss = latest('boss'); boss.currentTime = 22;
  won = true; music.update(0); await flush();
  assert.deepEqual(playing(), [boss]); assert.equal(boss.currentTime, 22);
  music.update(0.1); music.update(0.1); await flush();
  assert.equal(TestAudio.instances.length, 1);
  setAudioMenuPaused(true); music.setMenuOpen(true); music.setPaused(true); await flush();
  assert.deepEqual(playing(), [latest('menu')]);
  music.setMenuOpen(false); setAudioMenuPaused(false); music.setPaused(false); await flush();
  assert.deepEqual(playing(), [boss]); assert.equal(boss.currentTime, 22);
  music.enterScene('scene14', {}); await flush();
  music.update(MUSIC_CROSSFADE_SECONDS);
  assert.deepEqual(playing(), [latest('ship')], 'Descending to the hangar escape brings in the ship song');
  music.enterScene('scene15', {}); await flush();
  music.update(MUSIC_CROSSFADE_SECONDS);
  assert.deepEqual(playing(), [latest('level-2')]);
  assert.equal(MUSIC_URLS.victory, undefined);
  music.enterScene('scene17', { hasBossVictory: () => true }); await flush(); music.update(MUSIC_CROSSFADE_SECONDS);
  assert.deepEqual(playing(), [latest('planet')], 'Optional miniboss victories do not change the planet song');
});

test('the chain break switches immediately to Broken Chains and a new prologue resets the cue', async t => {
  const music = fixture(t);
  let broken = false;
  const prologueScene = { getMusicTrack: () => broken ? 'broken-chains' : 'prologue' };
  music.enterScene('prologue1', prologueScene); await flush();
  const prologue = latest('prologue');
  broken = true; music.update(0); await flush();
  assert.deepEqual(playing(), [latest('broken-chains')]);
  assert.equal(latest('broken-chains').volume, 0.5, 'The release cue starts at full gain, not halfway through a fade');
  assert.equal(prologue.paused, true);
  const released = latest('broken-chains'); released.currentTime = 8;
  music.update(0.1); await flush();
  assert.equal(latest('broken-chains'), released); assert.equal(released.currentTime, 8);
  broken = false; music.enterScene('prologue1', prologueScene); await flush();
  assert.deepEqual(playing(), [latest('prologue')]);
});

for (const fps of [30, 60, 144]) {
  test(`final boss crossfades over three seconds, switches to the final battle at the bomb blast, and ends on credits at ${fps} FPS`, async t => {
    const music = fixture(t); let phase = 'reveal', bombDetonated = false;
    const finale = { getMusicTrack: () => finaleMusicTrack(phase, bombDetonated), hasBossVictory: () => phase === 'victory' };
    music.enterScene('scene21', finale); await flush();
    const loading = latest('loading'); loading.currentTime = 60;
    for (const next of ['enemyTransform', 'heroTransform', 'versus']) { phase = next; music.update(0); }
    assert.equal(TestAudio.instances.length, 1, 'Intro phases must not restart Loading');
    phase = 'ground'; music.update(0); await flush();
    const battle = latest('ship');
    assert.equal(loading.volume, 0.5); assert.equal(battle.volume, 0);
    for (let frame = 0; frame < fps * 1.5; frame++) music.update(1 / fps);
    assert.ok(Math.abs(loading.volume - 0.5 * Math.SQRT1_2) < 1e-10);
    assert.ok(Math.abs(battle.volume - 0.5 * Math.SQRT1_2) < 1e-10);
    setAudioMenuPaused(true); music.setMenuOpen(true); music.setPaused(true); await flush();
    for (let frame = 0; frame < fps; frame++) music.update(1 / fps);
    assert.deepEqual(playing(), [latest('menu')]); assert.ok(Math.abs(battle.volume - 0.5 * Math.SQRT1_2) < 1e-10);
    music.setMenuOpen(false); setAudioMenuPaused(false); music.setPaused(false); await flush();
    for (let frame = 0; frame <= fps * 1.5; frame++) music.update(1 / fps);
    assert.equal(loading.paused, true); assert.equal(battle.volume, 0.5);
    battle.currentTime = 12;
    phase = 'rupture'; music.update(0); await flush();
    assert.equal(latest('ship'), battle); assert.equal(battle.currentTime, 12);
    assert.equal(latest('final-battle'), undefined, 'The Planet Breaker build-up keeps the duel song');
    bombDetonated = true; music.update(0); await flush();
    const finalBattle = latest('final-battle');
    music.update(MUSIC_CROSSFADE_SECONDS);
    assert.equal(battle.paused, true); assert.equal(finalBattle.loop, true); assert.deepEqual(playing(), [finalBattle]);
    finalBattle.currentTime = 12;
    for (const next of ['space', 'finisher']) { phase = next; music.update(0); }
    assert.equal(latest('final-battle'), finalBattle); assert.equal(finalBattle.currentTime, 12);
    phase = 'victory'; music.update(0); await flush();
    assert.deepEqual(playing(), [finalBattle]); assert.equal(finalBattle.currentTime, 12);
    phase = 'credits'; music.update(0); await flush();
    const credits = latest('credits');
    music.update(MUSIC_CROSSFADE_SECONDS);
    assert.equal(finalBattle.paused, true); assert.equal(credits.loop, true); assert.deepEqual(playing(), [credits]);
    credits.currentTime = 7; phase = 'done'; music.update(0);
    await flush();
    assert.equal(latest('credits'), credits); assert.equal(credits.currentTime, 7); assert.deepEqual(playing(), [credits]);
  });
}

test('the final battle begins with the bomb blast and survives a defeat in the space duel', () => {
  assert.equal(finaleMusicTrack('ground'), 'ship');
  assert.equal(finaleMusicTrack('rupture'), 'ship', 'Before the blast the duel song continues');
  assert.equal(finaleMusicTrack('rupture', true), 'final-battle');
  for (const phase of ['space', 'finisher', 'victory']) assert.equal(finaleMusicTrack(phase), 'final-battle', phase);
  assert.equal(finaleMusicTrack('defeat'), 'ship', 'A ground-duel defeat keeps the duel song');
  assert.equal(finaleMusicTrack('defeat', true), 'final-battle', 'A space-duel defeat keeps the final battle');
  assert.equal(finaleMusicTrack('credits', true), 'credits');
});

test('crossfades keep the outgoing track audible until the incoming track successfully starts', async t => {
  const manager = new AudioManager({ getFile: path => ({ content: path }) }); t.after(() => manager.dispose());
  manager.setBgm({ path: 'intro', volume: 0.5, autoplay: true }); await flush();
  const outgoing = manager.bgm.audio;
  TestAudio.nextFailure = new DOMException('Interaction required', 'NotAllowedError');
  manager.crossfadeBgm({ path: 'battle', volume: 0.5, autoplay: true }, 3); await flush();
  const incoming = manager.bgm.audio;
  manager.update(3);
  assert.equal(outgoing.volume, 0.5); assert.equal(incoming.volume, 0);
  assert.equal(outgoing.paused, false);
  window.dispatchEvent(new Event('keydown')); await flush(); manager.update(1.5);
  assert.ok(Math.abs(outgoing.volume - 0.5 * Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(incoming.volume - 0.5 * Math.SQRT1_2) < 1e-10);
  setAudioVolume('bgm', 0.4);
  assert.ok(Math.abs(outgoing.volume - 0.2 * Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(incoming.volume - 0.2 * Math.SQRT1_2) < 1e-10);
  manager.update(1.5); assert.equal(outgoing.paused, true); assert.equal(incoming.volume, 0.2);
});

test('prologue and caught-stealth cues start at full gain without advancing a fade timer', async t => {
  const music = fixture(t);
  music.enterScene('scene1', {}); await flush();
  const loading = latest('loading');
  music.enterScene('prologue1', {}); await flush();
  const prologue = latest('prologue');
  assert.equal(loading.paused, true); assert.equal(prologue.volume, 0.5);
  assert.deepEqual(playing(), [prologue]);
  let caught = false;
  music.enterScene('stage1-storage', { getMusicTrack: () => caught ? 'stealth-alert' : 'stealth-1' }); await flush();
  music.update(MUSIC_CROSSFADE_SECONDS);
  const stealth = latest('stealth-1');
  caught = true; music.update(0); await flush();
  assert.equal(stealth.paused, true); assert.equal(latest('stealth-alert').volume, 0.5);
  assert.deepEqual(playing(), [latest('stealth-alert')]);
});

test('a cancelled autoplay request cannot resurrect gameplay during the pause override', async t => {
  const manager = new AudioManager({ getFile: path => ({ content: path }) }); t.after(() => manager.dispose());
  TestAudio.nextFailure = new DOMException('Interaction required', 'NotAllowedError');
  manager.setBgm({ path: 'intro', autoplay: true });
  const audio = manager.bgm.audio; manager.pauseBgm(); await flush();
  window.dispatchEvent(new Event('keydown')); await flush();
  assert.equal(audio.paused, true); assert.equal(audio.playCount, 1); assert.equal(manager.autoplayQueue.size, 0);
});

test('invalid crossfade timing and actual playback failures surface explicitly', async t => {
  const manager = new AudioManager({ getFile: path => path === 'missing' ? null : { content: path } });
  t.after(() => manager.dispose());
  for (const duration of [0, -1, NaN, Infinity]) {
    assert.throws(() => manager.crossfadeBgm({ path: 'intro' }, duration), RangeError);
  }
  assert.throws(() => manager.setBgm({ path: 'missing' }), /Audio file not found/);
  assert.throws(() => manager.update(-1), RangeError);
  const warnings = []; t.mock.method(console, 'warn', (...args) => warnings.push(args));
  TestAudio.nextFailure = new DOMException('Unsupported file', 'NotSupportedError');
  manager.setBgm({ path: 'intro', autoplay: true }); await flush();
  assert.equal(warnings.length, 1); assert.match(warnings[0][0], /Playback failed/);
  assert.equal(manager.autoplayQueue.size, 0);
});

test('disposal cancels both sides of a fade and removes queued playback', async t => {
  const manager = new AudioManager({ getFile: path => ({ content: path }) }); t.after(() => manager.dispose());
  manager.setBgm({ path: 'intro', autoplay: true }); await flush();
  manager.crossfadeBgm({ path: 'battle', autoplay: true }); await flush();
  manager.update(1); manager.dispose();
  const counts = TestAudio.instances.map(audio => audio.playCount);
  window.dispatchEvent(new Event('keydown')); await flush();
  assert.deepEqual(playing(), []); assert.equal(manager.autoplayQueue.size, 0);
  assert.deepEqual(TestAudio.instances.map(audio => audio.playCount), counts);
});
