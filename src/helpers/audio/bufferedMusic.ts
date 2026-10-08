export const MUSIC_LOOP_BLEND_SECONDS = 0.65;
const CACHE_LIMIT = 4;
type PreparedMusic = { buffer: AudioBuffer; loopStart: number };
const prepared = new Map<string, Promise<PreparedMusic>>();
let context: AudioContext | null = null;

export function supportsBufferedMusic() {
  return typeof window.AudioContext === 'function';
}

function musicContext() {
  if (!context) context = new window.AudioContext();
  return context;
}

export function resumeMusicContext() {
  return context && context.state !== 'running' ? context.resume() : Promise.resolve();
}

export function prepareMusicLoop(audioContext: BaseAudioContext, original: AudioBuffer): PreparedMusic {
  const channels = Array.from({ length: original.numberOfChannels }, (_, channel) => original.getChannelData(channel));
  const audible = (frame: number) => channels.some(channel => Math.abs(channel[frame]) > 0.0005);
  let start = 0, end = original.length;
  while (start < end && !audible(start)) start++;
  while (end > start && !audible(end - 1)) end--;
  if (end === start) throw new Error('Cannot loop a silent music buffer');
  const padding = Math.ceil(original.sampleRate * 0.002);
  start = Math.max(0, start - padding); end = Math.min(original.length, end + padding);
  const length = end - start;
  const blend = Math.min(Math.round(MUSIC_LOOP_BLEND_SECONDS * original.sampleRate), Math.floor(length / 4));
  if (blend < 2) throw new Error('Music buffer is too short for a seamless loop');
  const buffer = audioContext.createBuffer(original.numberOfChannels, length, original.sampleRate);
  for (let channel = 0; channel < channels.length; channel++) {
    const source = channels[channel], output = buffer.getChannelData(channel);
    output.set(source.subarray(start, end));
    for (let frame = 0; frame < blend; frame++) {
      const angle = frame / (blend - 1) * Math.PI / 2;
      output[length - blend + frame] = source[end - blend + frame] * Math.cos(angle)
        + source[start + frame] * Math.sin(angle);
    }
  }
  // The first play keeps the opening; subsequent loops resume after the already blended opening.
  return { buffer, loopStart: blend / original.sampleRate };
}

function loadMusic(source: string, loop: boolean) {
  const key = `${loop}:${source}`;
  let pending = prepared.get(key);
  if (pending) { prepared.delete(key); prepared.set(key, pending); return pending; }
  const audioContext = musicContext();
  pending = fetch(source).then(async response => {
    if (!response.ok) throw new Error(`Music request failed (${response.status}): ${source}`);
    const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    return loop ? prepareMusicLoop(audioContext, buffer) : { buffer, loopStart: 0 };
  });
  prepared.set(key, pending);
  void pending.catch(() => { if (prepared.get(key) === pending) prepared.delete(key); });
  while (prepared.size > CACHE_LIMIT) prepared.delete(prepared.keys().next().value!);
  return pending;
}

export function preloadMusic(source: string, loop = true) {
  return supportsBufferedMusic() ? loadMusic(source, loop).then(() => undefined) : Promise.resolve();
}

export class BufferedMusic extends EventTarget {
  readonly ready: Promise<void>;
  readonly loop: boolean;
  paused = true;
  ended = false;
  private readonly context = musicContext();
  private readonly gain = this.context.createGain();
  private prepared: PreparedMusic | null = null;
  private source: AudioBufferSourceNode | null = null;
  private offset = 0;
  private startedAt = 0;
  private generation = 0;
  private disposed = false;

  constructor(readonly src: string, loop: boolean) {
    super();
    this.loop = loop;
    this.gain.connect(this.context.destination);
    this.ready = loadMusic(src, loop).then(music => { this.prepared = music; });
    void this.ready.catch(error => console.warn('[Audio] Music preparation failed:', src, error));
  }

  get volume() { return this.gain.gain.value; }
  set volume(value: number) {
    if (!Number.isFinite(value)) throw new RangeError('Music volume must be finite');
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.012);
  }
  get duration() { return this.prepared?.buffer.duration ?? 0; }
  get currentTime() {
    let time = this.offset + (this.source ? this.context.currentTime - this.startedAt : 0);
    if (this.loop && this.prepared && time >= this.duration) {
      const { loopStart } = this.prepared;
      time = loopStart + (time - loopStart) % (this.duration - loopStart);
    }
    return this.prepared ? Math.min(time, this.duration) : time;
  }
  set currentTime(value: number) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Music playback position must be finite and nonnegative');
    const playing = !this.paused;
    this.pause();
    this.offset = this.prepared ? Math.min(value, this.duration) : value;
    this.ended = false;
    if (playing) void this.play().catch(error => console.warn('[Audio] Music seek failed:', this.src, error));
  }
  async play() {
    if (this.disposed) throw new DOMException('Music playback was disposed', 'AbortError');
    if (this.context.state !== 'running') throw new DOMException('Music requires a user gesture', 'NotAllowedError');
    if (this.source) return;
    const generation = this.generation;
    await this.ready;
    if (this.disposed || generation !== this.generation) throw new DOMException('Music playback was cancelled', 'AbortError');
    if (this.source) return;
    const music = this.prepared;
    if (!music) throw new Error('Music has not been decoded');
    if (this.ended || this.offset >= this.duration) this.offset = 0;
    const source = this.context.createBufferSource();
    source.buffer = music.buffer;
    source.loop = this.loop;
    source.loopStart = music.loopStart;
    source.loopEnd = this.duration;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect(); this.source = null;
      this.offset = this.duration; this.paused = true; this.ended = true;
      this.dispatchEvent(new Event('ended'));
    };
    this.source = source;
    this.startedAt = this.context.currentTime;
    source.start(0, this.offset);
    this.paused = false; this.ended = false;
    this.dispatchEvent(new Event('playing'));
  }
  pause() {
    this.offset = this.currentTime;
    this.generation++;
    const source = this.source;
    this.source = null; this.paused = true;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
  }
  dispose() {
    if (this.disposed) return;
    this.pause(); this.disposed = true; this.gain.disconnect();
  }
}
