import * as THREE from 'three';

/**
 * Phase 4 (Bay Warden) ML human-detection HUD — round 2a. Additive; only scene13 phase 4 constructs it.
 * Projects a screen-space detection box around the player and each active holographic decoy using the
 * same inline `vec.project(camera)` pattern as renderer.ts placeMarker / scene14.ts (no shared helper
 * exists). All vectors are preallocated; update() never allocates.
 *
 * Each box carries a monospace "BRONDON 0.97" label. When the detection model breaks (all decoys active)
 * the boxes glitch: they jump between targets on a reshuffle timer and the labels flicker to error text.
 */
export interface DetectionHudTarget {
  position: THREE.Vector3;
  confidence: number;
  visible: boolean;
}

export function createPhase4DetectionHud({ container, camera, boxCount, boxHeight, boxWidthFactor, glitchLabels, glitchReshuffle }: {
  container: HTMLElement | null;
  camera: THREE.Camera;
  boxCount: number;
  boxHeight: number;
  boxWidthFactor: number;
  glitchLabels: readonly string[];
  glitchReshuffle: number;
}) {
  const boxes: Array<{ el: HTMLElement; label: HTMLElement }> = [];
  if (container) {
    for (let i = 0; i < boxCount; i++) {
      const el = document.createElement('div');
      el.className = 'p4-det-box hidden';
      const label = document.createElement('span');
      label.className = 'p4-det-label';
      el.appendChild(label);
      container.appendChild(el);
      boxes.push({ el, label });
    }
  }
  const _center = new THREE.Vector3(), _top = new THREE.Vector3();
  const perm = Array.from({ length: boxCount }, (_, i) => i);
  let shown = false, glitchTimer = 0, disposed = false;

  function shuffle() {
    for (let i = perm.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
  }

  return {
    show() { if (!container || shown) return; shown = true; container.classList.remove('hidden'); },
    hide() {
      if (!container || !shown) return; shown = false; container.classList.add('hidden');
      for (const box of boxes) box.el.classList.add('hidden');
    },
    get visible() { return shown; },
    /**
     * @param targets  fixed-order candidate list (index 0 = player, i+1 = decoy i); read in place.
     * @param failing  true while the detection model is breaking (all decoys active).
     * @param aimedBox index of the box the boss is currently telegraphing, or -1 for none.
     */
    update(dt: number, targets: readonly DetectionHudTarget[], failing: boolean, aimedBox: number) {
      if (disposed || !shown || !boxes.length) return;
      if (failing) { glitchTimer -= dt; if (glitchTimer <= 0) { glitchTimer = glitchReshuffle; shuffle(); } }
      else if (glitchTimer !== 0) { glitchTimer = 0; for (let i = 0; i < perm.length; i++) perm[i] = i; }
      const width = window.innerWidth, height = window.innerHeight;
      for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b];
        const src = failing ? targets[perm[b] % targets.length] : targets[b];
        if (!src || !src.visible) { box.el.classList.add('hidden'); continue; }
        _center.copy(src.position).project(camera);
        if (_center.z > 1 || Math.abs(_center.x) > 1.25 || Math.abs(_center.y) > 1.25) { box.el.classList.add('hidden'); continue; }
        _top.copy(src.position); _top.y += boxHeight * 0.5; _top.project(camera);
        const cx = (_center.x + 1) * 0.5 * width, cy = (1 - _center.y) * 0.5 * height;
        const topY = (1 - _top.y) * 0.5 * height;
        const boxH = Math.max(28, Math.abs(cy - topY) * 2), boxW = boxH * boxWidthFactor;
        box.el.classList.remove('hidden');
        box.el.classList.toggle('aimed', b === aimedBox);
        box.el.style.left = `${cx - boxW * 0.5}px`;
        box.el.style.top = `${cy - boxH * 0.5}px`;
        box.el.style.width = `${boxW}px`;
        box.el.style.height = `${boxH}px`;
        box.label.textContent = failing
          ? glitchLabels[(Math.random() * glitchLabels.length) | 0]
          : `BRONDON ${src.confidence.toFixed(2)}`;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const box of boxes) box.el.remove();
      boxes.length = 0;
      if (container) container.classList.add('hidden');
      shown = false;
    },
  };
}

export type Phase4DetectionHud = ReturnType<typeof createPhase4DetectionHud>;
