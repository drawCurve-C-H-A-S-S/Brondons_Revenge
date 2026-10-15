import * as THREE from 'three';
import { decompressFrames, parseGIF } from 'gifuct-js';
import corridorOne from '../../assets/surveillance/corridor-bots-1.gif';
import corridorTwo from '../../assets/surveillance/corridor-bots-2.gif';
import corridorThree from '../../assets/surveillance/corridor-bots-3.gif';
import { fetchAsset } from '../../core/assetCache.js';
import { yieldToMainThread } from '../../core/loader.js';

export const CORRIDOR_FOOTAGE = [corridorOne, corridorTwo, corridorThree] as const;
interface CorridorClip { frames: { pixels: Uint8ClampedArray; until: number }[]; duration: number; }
const clips = new Map<string, Promise<CorridorClip>>();

export function decodeCorridorGif(buffer: ArrayBuffer): CorridorClip {
  const parsed = parseGIF(buffer), width = parsed.lsd.width, height = parsed.lsd.height;
  if (width !== 384 || height !== 216) throw new Error('Corridor GIF footage must be 384 x 216');
  const source = decompressFrames(parsed, true);
  if (source.length < 2) throw new Error('Corridor footage must contain an animated GIF, not a still image');
  let duration = 0, pixels = new Uint8ClampedArray(width * height * 4), restore: Uint8ClampedArray | null = null;
  const frames: CorridorClip['frames'] = [];
  source.forEach((frame, index) => {
    const previous = source[index - 1], { dims } = frame;
    if (previous?.disposalType === 2) {
      for (let row = previous.dims.top; row < previous.dims.top + previous.dims.height; row++)
        pixels.fill(0, (row * width + previous.dims.left) * 4, (row * width + previous.dims.left + previous.dims.width) * 4);
    } else if (previous?.disposalType === 3 && restore) pixels.set(restore);
    restore = frame.disposalType === 3 ? pixels.slice() : null;
    if (dims.left < 0 || dims.top < 0 || dims.left + dims.width > width || dims.top + dims.height > height
      || frame.patch.length !== dims.width * dims.height * 4 || !Number.isFinite(frame.delay))
      throw new Error('Invalid corridor GIF frame');
    for (let y = 0; y < dims.height; y++) for (let x = 0; x < dims.width; x++) {
      const from = (y * dims.width + x) * 4;
      if (!frame.patch[from + 3]) continue;
      const to = ((y + dims.top) * width + x + dims.left) * 4;
      pixels[to] = frame.patch[from]; pixels[to + 1] = frame.patch[from + 1];
      pixels[to + 2] = frame.patch[from + 2]; pixels[to + 3] = frame.patch[from + 3];
    }
    duration += Math.max(0.01, frame.delay / 1000); frames.push({ pixels: pixels.slice(), until: duration });
  });
  return { frames, duration };
}

function corridorClip(url: string) {
  let pending = clips.get(url);
  if (!pending) {
    pending = fetchAsset(url).then(async response => {
      if (!response.ok) throw new Error(`Corridor monitor footage: HTTP ${response.status}`);
      return decodeCorridorGif(await response.arrayBuffer());
    }).catch(error => { clips.delete(url); throw error; });
    clips.set(url, pending);
  }
  return pending;
}

export async function preloadCorridorFootage() {
  for (const url of CORRIDOR_FOOTAGE) {
    await corridorClip(url);
    await yieldToMainThread();
  }
}

export function createCorridorMonitor(index: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 216;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the corridor monitor canvas');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const image = context.createImageData(384, 216);
  let disposed = false, clip: CorridorClip | null = null, elapsed = index * 0.17, currentFrame = -1;
  const draw = () => {
    if (!clip || disposed) return;
    const time = elapsed % clip.duration, frame = clip.frames.findIndex(frame => time < frame.until);
    if (frame === currentFrame) return;
    image.data.set(clip.frames[frame].pixels); context.putImageData(image, 0, 0); texture.needsUpdate = true; currentFrame = frame;
  };
  const url = CORRIDOR_FOOTAGE[(index + Math.floor(Math.random() * CORRIDOR_FOOTAGE.length)) % CORRIDOR_FOOTAGE.length];
  const ready = corridorClip(url).then(decoded => {
    if (!disposed) { clip = decoded; draw(); }
  });
  return {
    texture, ready,
    update(dt: number) {
      if (disposed || !clip) return;
      elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0; draw();
    },
    getFrameIndex: () => currentFrame,
    dispose() { disposed = true; clip = null; texture.dispose(); },
  };
}
