import { getAudioSettings, subscribeAudioSettings } from '../helpers/audio/AudioManager.js';

/** Procedural ignition, swing, clash, and hum from the ASCII shader branch. */
export class LightsaberAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private igniteBuffer: AudioBuffer | null = null;
  private swingBuffer: AudioBuffer | null = null;
  private clashBuffer: AudioBuffer | null = null;
  private humBuffer: AudioBuffer | null = null;
  private humSource: AudioBufferSourceNode | null = null;
  private humGain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private disposed = false;
  private stopSettings = subscribeAudioSettings(settings => {
    if (this.output) this.output.gain.value = settings.paused ? 0 : settings.sfx;
    if (this.context && this.context.state !== 'closed') {
      const change = settings.paused ? this.context.suspend() : this.context.resume();
      void change.catch(() => {});
    }
  });

  private getContext(): AudioContext | null {
    if (this.disposed || getAudioSettings().paused) return null;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = getAudioSettings().sfx;
        this.output.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
      return this.context;
    } catch { return null; }
  }

  private generateIgnite(ctx: AudioContext): AudioBuffer {
    if (this.igniteBuffer) return this.igniteBuffer;
    const duration = 0.6;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const progress = t / duration;
      // Rising frequency sweep (80 Hz to 200 Hz)
      const freq = 80 + progress * 120;
      // Amplitude envelope (fast attack, slow decay)
      const amp = progress < 0.1 ? progress * 10 : Math.exp(-(progress - 0.1) * 3);
      // Combine fundamental and harmonics
      data[i] = amp * (
        Math.sin(2 * Math.PI * freq * t) * 0.6 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.3 +
        Math.sin(2 * Math.PI * freq * 3 * t) * 0.1
      );
    }
    return this.igniteBuffer = buffer;
  }

  private generateSwing(ctx: AudioContext): AudioBuffer {
    if (this.swingBuffer) return this.swingBuffer;
    const duration = 0.3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const progress = t / duration;
      // Whoosh effect: filtered noise with frequency modulation
      const freq = 150 + Math.sin(progress * Math.PI) * 100;
      const amp = Math.sin(progress * Math.PI) * 0.5;
      // Add some noise for the "swoosh"
      const noise = (Math.random() * 2 - 1) * 0.3;
      data[i] = amp * (Math.sin(2 * Math.PI * freq * t) * 0.7 + noise * 0.3);
    }
    return this.swingBuffer = buffer;
  }

  private generateClash(ctx: AudioContext): AudioBuffer {
    if (this.clashBuffer) return this.clashBuffer;
    const duration = 0.4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const progress = t / duration;
      // Sharp attack with metallic ring
      const freq = 400 + Math.random() * 200;
      const amp = progress < 0.05 ? progress * 20 : Math.exp(-(progress - 0.05) * 8);
      data[i] = amp * (
        Math.sin(2 * Math.PI * freq * t) * 0.5 +
        Math.sin(2 * Math.PI * freq * 2.5 * t) * 0.3 +
        (Math.random() * 2 - 1) * 0.2
      );
    }
    return this.clashBuffer = buffer;
  }

  private play(makeBuffer: (ctx: AudioContext) => AudioBuffer, volume: number) {
    const ctx = this.getContext();
    if (!ctx || !this.output) return;
    const source = ctx.createBufferSource();
    source.buffer = makeBuffer(ctx);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain).connect(this.output);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); };
    source.start();
  }

  playIgnite(volume = 0.5) { this.play(ctx => this.generateIgnite(ctx), volume); }
  playSwing(volume = 0.4) { this.play(ctx => this.generateSwing(ctx), volume); }
  playClash(volume = 0.6) { this.play(ctx => this.generateClash(ctx), volume); }

  playParry(volume = 0.7) {
    const ctx = this.getContext();
    if (!ctx || !this.output) return;
    const source = ctx.createBufferSource();
    source.buffer = this.generateClash(ctx);
    source.playbackRate.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain).connect(this.output);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); };
    source.start();
  }

  startHum(volume = 0.15) {
    if (this.humSource) return;
    const ctx = this.getContext();
    if (!ctx || !this.output) return;
    if (!this.humBuffer) {
      this.humBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.humBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        data[i] = (Math.sin(2 * Math.PI * 100 * t) * 0.6 + Math.sin(2 * Math.PI * 200 * t) * 0.3) * 0.3;
      }
    }
    this.humSource = ctx.createBufferSource();
    this.humSource.buffer = this.humBuffer;
    this.humSource.loop = true;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = Math.max(0, Math.min(1, volume));
    this.humSource.connect(this.humGain).connect(this.output);
    this.humSource.start();
  }

  stopHum() {
    if (!this.humSource) return;
    this.humSource.stop();
    this.humSource.disconnect();
    this.humGain?.disconnect();
    this.humSource = null;
    this.humGain = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSettings();
    this.stopHum();
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.output?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.output = null;
    this.igniteBuffer = this.swingBuffer = this.clashBuffer = this.humBuffer = null;
  }
}
