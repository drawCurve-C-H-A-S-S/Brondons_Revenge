import * as THREE from 'three';
import { loadMCModel, yieldToMainThread } from '../../core/loader.js';
import { captureFinaleResources, normalizeFinaleActor } from './finaleActors.js';

export async function createFinaleCreditSprite(renderer: THREE.WebGLRenderer) {
  const asset = await loadMCModel(), resources = captureFinaleResources(asset.scene);
  const scene = new THREE.Scene();
  scene.add(normalizeFinaleActor(asset.scene, 1.83));
  const clip = asset.animations.find(animation => animation.name === 'Dance_Loop');
  if (!clip) { resources.dispose(); throw new Error('Brondon needs Dance_Loop for the credits image'); }
  const mixer = new THREE.AnimationMixer(asset.scene), action = mixer.clipAction(clip).play();
  action.paused = true;
  scene.add(new THREE.HemisphereLight(0xfff4db, 0x16344b, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x66dfff, 2); rim.position.set(-3, 2, -3); scene.add(rim);
  const camera = new THREE.OrthographicCamera(-0.9, 0.9, 1.2, -1.2, 0.1, 20);
  camera.position.set(0, 1, 5); camera.lookAt(0, 1, 0);
  const width = 192, height = 256, frames = 24;
  const sheet = document.createElement('canvas'); sheet.width = width * (frames + 1); sheet.height = height;
  const context = sheet.getContext('2d');
  if (!context) { resources.dispose(); mixer.uncacheRoot(asset.scene); throw new Error('The credits image needs a 2D canvas'); }
  const target = new THREE.WebGLRenderTarget(width, height);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const pixels = new Uint8Array(width * height * 4), flipped = new Uint8ClampedArray(pixels.length);
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clearColor = new THREE.Color();
  try {
    for (let frame = 0; frame < frames; frame++) {
      action.time = frame / frames * clip.duration; mixer.update(0); scene.updateMatrixWorld(true);
      renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getClearColor(clearColor);
      const oldTarget = renderer.getRenderTarget(), oldAlpha = renderer.getClearAlpha();
      const oldAutoClear = renderer.autoClear, oldScissor = renderer.getScissorTest(), oldShadows = renderer.shadowMap.autoUpdate;
      try {
        renderer.shadowMap.autoUpdate = false; renderer.autoClear = true; renderer.setScissorTest(false);
        renderer.setRenderTarget(target); renderer.setViewport(0, 0, width, height); renderer.setClearColor(0x000000, 0);
        renderer.clear(); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      } finally {
        renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor);
        renderer.setScissorTest(oldScissor); renderer.setClearColor(clearColor, oldAlpha);
        renderer.autoClear = oldAutoClear; renderer.shadowMap.autoUpdate = oldShadows;
      }
      for (let row = 0; row < height; row++) {
        flipped.set(pixels.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
      }
      context.putImageData(new ImageData(flipped, width, height), frame * width, 0);
      if (frame % 6 === 5) await yieldToMainThread();
    }
    context.drawImage(sheet, 0, 0, width, height, frames * width, 0, width, height);
    return { image: sheet.toDataURL('image/png'), frames, duration: clip.duration, aspect: width / height };
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); target.dispose(); resources.dispose();
  }
}
