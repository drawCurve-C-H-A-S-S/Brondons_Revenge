import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { access } from 'node:fs/promises';
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
    loading: 'Loading.m4a', emotional: 'Emotional.m4a', 'living-quarters': 'Living quarters.m4a', menu: 'Menu.m4a',
    'stealth-1': 'Stealth1.m4a', 'stealth-2': 'Stealth1 2.m4a', 'stealth-alert': 'Stealth1 3.m4a',
    ship: 'DonRevBGM1.m4a', 'level-2': 'DonRevLevel2.m4a', 'level-2-boss': 'DonRevLevel2Boss.m4a',
    jungle: 'DonRevJungleLoop.m4a', victory: 'Victory boss 1.m4a', credits: 'Level 2.m4a',
  };
  assert.deepEqual(Object.keys(MUSIC_URLS).sort(), Object.keys(names).sort());
  for (const [track, name] of Object.entries(names)) {
    assert.equal(decodeURIComponent(MUSIC_URLS[track]).split('/').at(-1), name);
    await access(new URL(`../src/assets/bgm/${name}`, import.meta.url));
  }
  assert.notEqual(MUSIC_URLS.credits, MUSIC_URLS['level-2']);
});

test('scene entry selects the requested loops while preserving existing ship and jungle music', async t => {
  const music = fixture(t);
  for (const [id, track] of [
    ['scene1', 'loading'], ['prologue1', 'emotional'], ['living-quarters', 'living-quarters'],
    ['stage1-storage', 'stealth-1'], ['scene13', 'ship'], ['scene14', 'ship'],
    ['scene15', 'level-2'], ['scene16', 'level-2'], ['scene17', 'jungle'], ['scene18', 'jungle'], ['scene19', 'jungle'],
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

test('boss victory plays once, survives scene transitions, pauses for M, and restores the current scene soundtrack', async t => {
  const music = fixture(t); let won = false;
  const bossScene = { hasBossVictory: () => won };
  music.enterScene('scene13', bossScene); await flush();
  const ship = latest('ship'); ship.currentTime = 22;
  won = true; music.update(0); await flush();
  const victory = latest('victory');
  assert.equal(victory.loop, false); assert.deepEqual(playing(), [victory]);
  assert.equal(ship.paused, true);
  music.update(0.1); music.update(0.1); await flush();
  assert.equal(TestAudio.instances.filter(audio => audio.src === MUSIC_URLS.victory).length, 1);
  music.enterScene('scene14', {}); await flush();
  assert.deepEqual(playing(), [victory], 'Descending cannot truncate the victory track');
  victory.currentTime = 4;
  setAudioMenuPaused(true); music.setMenuOpen(true); music.setPaused(true); await flush();
  assert.deepEqual(playing(), [latest('menu')]);
  music.setMenuOpen(false); setAudioMenuPaused(false); music.setPaused(false); await flush();
  assert.deepEqual(playing(), [victory]); assert.equal(victory.currentTime, 4);
  music.enterScene('scene15', {}); await flush();
  assert.equal(latest('level-2').paused, true); assert.deepEqual(playing(), [victory]);
  victory.finish(); await flush();
  assert.deepEqual(playing(), [latest('level-2')]);
  music.enterScene('scene13', bossScene); music.update(0); await flush();
  assert.equal(TestAudio.instances.filter(audio => audio.src === MUSIC_URLS.victory).length, 1);
  music.enterScene('scene18', { hasBossVictory: () => true }); await flush();
  assert.equal(TestAudio.instances.filter(audio => audio.src === MUSIC_URLS.victory).length, 2, 'A different boss gets its own one-shot');
});

for (const fps of [30, 60, 144]) {
  test(`final boss crossfades over three seconds, keeps its battle track across phases, and switches to credits at ${fps} FPS`, async t => {
    const music = fixture(t); let phase = 'reveal';
    const finale = { getMusicTrack: () => finaleMusicTrack(phase), hasBossVictory: () => phase === 'victory' };
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
    for (const next of ['rupture', 'space', 'finisher']) { phase = next; music.update(0); }
    assert.equal(latest('ship'), battle); assert.equal(battle.currentTime, 12);
    phase = 'victory'; music.update(0); await flush();
    const victory = latest('victory');
    assert.equal(victory.loop, false); assert.deepEqual(playing(), [victory]);
    phase = 'credits'; music.update(0); await flush();
    const credits = latest('credits');
    assert.equal(victory.paused, true); assert.equal(credits.loop, true); assert.deepEqual(playing(), [credits]);
    credits.currentTime = 7; phase = 'done'; music.update(0);
    victory.dispatchEvent(new Event('ended')); await flush();
    assert.equal(latest('credits'), credits); assert.equal(credits.currentTime, 7); assert.deepEqual(playing(), [credits]);
  });
}

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

test('ordinary scene changes overlap smoothly, and rapid changes do not drop the audible mix', async t => {
  const music = fixture(t);
  music.enterScene('scene1', {}); await flush();
  const loading = latest('loading');
  music.enterScene('prologue1', {}); await flush();
  const emotional = latest('emotional');
  assert.equal(loading.volume, 0.5); assert.equal(emotional.volume, 0);
  music.update(MUSIC_CROSSFADE_SECONDS / 2);
  const volumes = [loading.volume, emotional.volume];
  music.enterScene('living-quarters', {}); await flush();
  assert.deepEqual([loading.volume, emotional.volume], volumes, 'Already audible tracks survive another cue change');
  assert.equal(latest('living-quarters').volume, 0);
  music.update(MUSIC_CROSSFADE_SECONDS);
  assert.deepEqual(playing(), [latest('living-quarters')]);
  assert.equal(latest('living-quarters').volume, 0.5);
});

test('a cancelled autoplay request cannot resurrect gameplay during the victory or pause override', async t => {
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
