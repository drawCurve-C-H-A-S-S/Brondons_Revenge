import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, BufferedMusic, prepareMusicLoop, resumeMusicContext, AudioManager;
const original = { window: globalThis.window, fetch: globalThis.fetch };
class Buffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}
function recording() {
  const buffer = new Buffer(2, 5000, 1000);
  for (let channel = 0; channel < 2; channel++) for (let frame = 500; frame < 4200; frame++) {
    buffer.channels[channel][frame] = Math.sin((frame - 500) * 0.037 + channel * 0.4) * 0.3;
  }
  return buffer;
}
class Context {
  static instance;
  currentTime = 0; state = 'running'; destination = {}; sources = []; decoded = 0;
  constructor() { Context.instance = this; }
  createBuffer(...args) { return new Buffer(...args); }
  async decodeAudioData() { this.decoded++; return recording(); }
  createGain() {
    return { gain: { value: 1, setTargetAtTime(value) { this.value = value; } },
      connect() {}, disconnect() {} };
  }
  createBufferSource() {
    const source = { stopped: false, starts: 0, onended: null,
      connect() {}, disconnect() {}, start(when, offset) { this.starts++; this.offset = offset; },
      stop() { this.stopped = true; }, finish() { this.onended?.(); } };
    this.sources.push(source); return source;
  }
  async resume() { this.state = 'running'; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

before(async () => {
  globalThis.window = Object.assign(new EventTarget(), { AudioContext: Context });
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  ({ BufferedMusic, prepareMusicLoop, resumeMusicContext } = await server.ssrLoadModule('/helpers/audio/bufferedMusic.ts'));
  ({ AudioManager } = await server.ssrLoadModule('/helpers/audio/AudioManager.js'));
});
after(async () => { await server?.close(); Object.assign(globalThis, original); });

test('decoded loops remove silent padding and join at the next adjacent musical sample', () => {
  const source = recording(), context = new Context();
  const { buffer, loopStart } = prepareMusicLoop(context, source);
  assert.ok(buffer.duration < source.duration - 1, 'Leading and trailing padding are not part of the loop');
  assert.ok(loopStart > 0 && loopStart <= 0.65);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel), next = Math.round(loopStart * buffer.sampleRate);
    assert.ok(Math.abs(data.at(-1) - data[next]) < 0.02, 'The wrap has only the natural adjacent-sample change');
    assert.ok(Math.max(...data) > 0.25, 'Looping retains the musical signal');
    assert.ok(data.every(Number.isFinite));
  }
  assert.throws(() => prepareMusicLoop(context, new Buffer(2, 3000, 1000)), /silent/);
});

test('music uses one sample-clock loop without replay callbacks, and resumes the exact paused position', async t => {
  const music = new BufferedMusic('buffer-loop', true); t.after(() => music.dispose());
  await music.ready; await music.play();
  const context = Context.instance, source = context.sources.at(-1);
  assert.equal(source.loop, true); assert.equal(source.loopEnd, music.duration);
  assert.ok(source.loopStart > 0);
  context.currentTime += music.duration * 4 + 0.137;
  const position = music.currentTime;
  assert.ok(position >= source.loopStart && position < music.duration);
  assert.equal(source.starts, 1, 'Crossing four seams never creates a new playback request');
  music.pause(); context.currentTime += 5;
  assert.equal(music.currentTime, position); assert.equal(source.stopped, true);
  await music.play();
  assert.equal(context.sources.at(-1).offset, position);
});

test('reusing a track shares decoded data while maintaining independent playback nodes', async t => {
  const first = new BufferedMusic('cached-music', true), second = new BufferedMusic('cached-music', true);
  t.after(() => { first.dispose(); second.dispose(); });
  const decoded = Context.instance.decoded;
  await Promise.all([first.ready, second.ready]);
  assert.equal(Context.instance.decoded - decoded, 1);
  await Promise.all([first.play(), second.play()]);
  assert.notEqual(Context.instance.sources.at(-1), Context.instance.sources.at(-2));
  assert.equal(Context.instance.sources.at(-1).buffer, Context.instance.sources.at(-2).buffer);
});

test('one-shot victory keeps the full recording and emits ended only for natural completion', async t => {
  const music = new BufferedMusic('victory-one-shot', false); t.after(() => music.dispose());
  await music.ready;
  assert.equal(music.duration, 5);
  let ended = 0; music.addEventListener('ended', () => ended++);
  await music.play(); music.pause();
  assert.equal(ended, 0);
  await music.play(); Context.instance.sources.at(-1).finish();
  assert.equal(ended, 1); assert.equal(music.paused, true); assert.equal(music.ended, true);
});

test('gesture unlock and cancellation cannot restart a disposed or loading track', async t => {
  const music = new BufferedMusic('gesture-loop', true); t.after(() => music.dispose());
  await music.ready;
  Context.instance.state = 'suspended';
  await assert.rejects(music.play(), { name: 'NotAllowedError' });
  await resumeMusicContext(); await music.play(); music.pause();
  const play = music.play(); music.dispose();
  await assert.rejects(play, { name: 'AbortError' });
  assert.equal(music.paused, true);
  await assert.rejects(music.play(), { name: 'AbortError' });
});

test('a crossfade holds the outgoing sound until incoming decoding finishes', async t => {
  const manager = new AudioManager({ getFile: path => ({ content: path }) }); t.after(() => manager.dispose());
  manager.setBgm({ path: 'buffered-outgoing', volume: 0.5, autoplay: true }); await flush();
  const outgoing = manager.bgm.audio;
  let finishFetch;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finishFetch = resolve; }));
  manager.crossfadeBgm({ path: 'buffered-incoming', volume: 0.5, autoplay: true }, 1);
  await flush();
  manager.update(1);
  assert.equal(outgoing.paused, false); assert.equal(outgoing.volume, 0.5);
  assert.equal(manager.bgm.audio.volume, 0);
  finishFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }); await flush();
  manager.update(0.5);
  assert.ok(Math.abs(outgoing.volume - Math.SQRT1_2 * 0.5) < 1e-10);
  assert.ok(Math.abs(manager.bgm.audio.volume - Math.SQRT1_2 * 0.5) < 1e-10);
  manager.update(0.5); assert.equal(outgoing.paused, true); assert.equal(manager.bgm.audio.volume, 0.5);
});
