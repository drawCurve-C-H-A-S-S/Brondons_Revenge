import * as THREE from 'three';

/**
 * Procedural lightsaber audio generator.
 * Creates ignition, swing, and clash sounds using Web Audio API oscillators.
 */
export class LightsaberAudio {
  private context: AudioContext | null = null;
  private igniteBuffer: AudioBuffer | null = null;
  private swingBuffer: AudioBuffer | null = null;
  private clashBuffer: AudioBuffer | null = null;
  private humSource: AudioBufferSourceNode | null = null;
  private humGain: GainNode | null = null;

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.context.state === 'suspended') this.context.resume();
    return this.context;
  }

  private async generateIgnite(): Promise<AudioBuffer> {
    if (this.igniteBuffer) return this.igniteBuffer;
    const ctx = this.getContext();
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

    this.igniteBuffer = buffer;
    return buffer;
  }

  private async generateSwing(): Promise<AudioBuffer> {
    if (this.swingBuffer) return this.swingBuffer;
    const ctx = this.getContext();
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

    this.swingBuffer = buffer;
    return buffer;
  }

  private async generateClash(): Promise<AudioBuffer> {
    if (this.clashBuffer) return this.clashBuffer;
    const ctx = this.getContext();
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

    this.clashBuffer = buffer;
    return buffer;
  }

  async playIgnite(volume = 0.5) {
    const ctx = this.getContext();
    const buffer = await this.generateIgnite();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  async playSwing(volume = 0.4) {
    const ctx = this.getContext();
    const buffer = await this.generateSwing();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  async playClash(volume = 0.6) {
    const ctx = this.getContext();
    const buffer = await this.generateClash();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  startHum(volume = 0.15) {
    if (this.humSource) return;
    const ctx = this.getContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      data[i] = (Math.sin(2 * Math.PI * 100 * t) * 0.6 + Math.sin(2 * Math.PI * 200 * t) * 0.3) * 0.3;
    }
    this.humSource = ctx.createBufferSource();
    this.humSource.buffer = buffer;
    this.humSource.loop = true;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = volume;
    this.humSource.connect(this.humGain).connect(ctx.destination);
    this.humSource.start();
  }

  stopHum() {
    if (this.humSource) {
      this.humSource.stop();
      this.humSource = null;
      this.humGain = null;
    }
  }

  dispose() {
    this.stopHum();
    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }
}
