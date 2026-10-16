import * as THREE from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { loadPlayerModel } from '../core/loader.js';
import hologramVertexShader from '../shaders/hologram.vert.glsl?raw';
import hologramFragmentShader from '../shaders/hologram.frag.glsl?raw';

/**
 * Phase 4 (Bay Warden zero-G barrage) holographic decoys — round 2a. Additive; only scene13 phase 4
 * ever constructs this. The AI's human-detection model is fooled by planting holographic copies of the
 * player at fixed anchors. Each decoy is an independent SkeletonUtils clone of the player rig wearing its
 * OWN hologram ShaderMaterial (built from the shared hologram.vert/frag.glsl, exactly like flightShield
 * and the prologue flashbacks) so flicker and net-impact glitches never bleed between decoys.
 *
 * The real player is never touched: this module never calls characterManager.setHologramTransition and
 * never registers a full-screen pass. Decoys stay hidden until planted, then flicker in over a short
 * window and idle on a slow AnimationMixer loop.
 */
export interface Phase4DecoyRules {
  count: number;
  color: number;
  height: number;
  idleTimeScale: number;
  flickerIn: number;
  timeOffset: number;
  glitchSeconds: number;
}

interface Decoy {
  root: THREE.Group;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  material: THREE.ShaderMaterial;
  active: boolean;
  flicker: number;
  glitch: number;
  timeOffset: number;
}

export function createPhase4Decoys({ scene, rules }: { scene: THREE.Scene; rules: Phase4DecoyRules }) {
  const holder = new THREE.Group(); holder.name = 'Phase4Decoys'; holder.userData.minimap = false; scene.add(holder);
  const decoys: Decoy[] = [];
  // Cloned geometries are shared across every decoy (one clone per unique source geometry) so the pool
  // stays cheap; they are disposed once, here, not per decoy.
  const sharedGeometries: THREE.BufferGeometry[] = [];
  let elapsed = 0, disposed = false, ready = false;

  for (let i = 0; i < rules.count; i++) {
    // One hologram material PER decoy: independent hologramTime offset and hologramImpact glitch spikes.
    const material = new THREE.ShaderMaterial({
      uniforms: { hologramTime: { value: 0 }, hologramColor: { value: new THREE.Color(rules.color) }, hologramImpact: { value: 0 } },
      vertexShader: hologramVertexShader, fragmentShader: hologramFragmentShader,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const root = new THREE.Group(); root.name = `Phase4Decoy-${i}`; root.visible = false; root.userData.minimap = false;
    holder.add(root);
    decoys.push({ root, model: null, mixer: null, material, active: false, flicker: 0, glitch: 0, timeOffset: i * rules.timeOffset });
  }

  // Build every clone from a single decoded player template (the prologueFlashbacks L480-516 pattern).
  const build = loadPlayerModel().then(gltf => {
    if (disposed) return;
    const geometryCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    const idle = gltf.animations.find(clip => clip.name === 'Idle_Loop') ?? gltf.animations[0];
    for (const decoy of decoys) {
      const model = cloneRig(gltf.scene);
      model.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const source: THREE.BufferGeometry = node.geometry;
        let geometry = geometryCache.get(source);
        if (!geometry) { geometry = source.clone(); geometryCache.set(source, geometry); sharedGeometries.push(geometry); }
        node.geometry = geometry;
        node.material = decoy.material;
        node.castShadow = node.receiveShadow = false;
      });
      const bounds = new THREE.Box3().setFromObject(model, true);
      const size = bounds.getSize(new THREE.Vector3());
      if (Number.isFinite(size.y) && size.y > 0.001) model.scale.multiplyScalar(rules.height / size.y);
      if (idle) {
        decoy.mixer = new THREE.AnimationMixer(model);
        const action = decoy.mixer.clipAction(idle).play();
        action.timeScale = rules.idleTimeScale;
        decoy.mixer.setTime(decoy.timeOffset);   // desync the idle loop per decoy
      }
      model.updateMatrixWorld(true);
      // Recompute cloned skin bounds only after every bone has its final world matrix (hangarVersus L78-84).
      model.traverse(node => {
        if (node instanceof THREE.SkinnedMesh) { node.skeleton.update(); node.computeBoundingBox(); node.computeBoundingSphere(); }
      });
      const fitted = new THREE.Box3().setFromObject(model, true);
      const center = fitted.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -fitted.min.y, -center.z);   // feet planted at the decoy root origin
      decoy.model = model; decoy.root.add(model); decoy.root.updateMatrixWorld(true);
    }
    ready = true;
  }).catch(error => console.warn('[Phase 4] Holographic decoy rig unavailable.', error));

  return {
    get ready() { return ready; },
    get build() { return build; },
    get count() { return rules.count; },
    isActive(index: number) { return decoys[index]?.active === true; },
    /** Live world position of a decoy root (its feet). Returns the internal vector; never allocates. */
    getPosition(index: number) { return decoys[index].root.position; },
    activeCount() { let n = 0; for (const d of decoys) if (d.active) n++; return n; },
    /** Reveal a hidden decoy at `position` with a short flicker-in. Returns false if already active. */
    plant(index: number, position: THREE.Vector3) {
      const decoy = decoys[index];
      if (!decoy || decoy.active) return false;
      decoy.active = true; decoy.flicker = 0; decoy.glitch = 0;
      decoy.root.position.copy(position);
      decoy.root.visible = true;
      return true;
    },
    /** Net-impact glitch spike on one decoy; it stays active. */
    glitch(index: number) { const decoy = decoys[index]; if (decoy && decoy.active) decoy.glitch = rules.glitchSeconds; },
    /** Deactivate every decoy (used on the exposed-window return; NOT on a trapped retry). */
    resetAll() { for (const d of decoys) { d.active = false; d.flicker = 0; d.glitch = 0; d.root.visible = false; } },
    update(dt: number) {
      if (disposed) return;
      elapsed += dt;
      for (const decoy of decoys) {
        if (!decoy.active) { if (decoy.root.visible) decoy.root.visible = false; continue; }
        if (decoy.flicker < 1) decoy.flicker = Math.min(1, decoy.flicker + dt / Math.max(0.0001, rules.flickerIn));
        // Stochastic reveal during the flicker-in, then solid.
        decoy.root.visible = decoy.flicker >= 1 || Math.random() < decoy.flicker;
        decoy.glitch = Math.max(0, decoy.glitch - dt);
        const impact = decoy.glitch > 0 ? decoy.glitch / rules.glitchSeconds : 0;
        const flickerBoost = decoy.flicker < 1 ? (1 - decoy.flicker) * 0.5 : 0;
        decoy.material.uniforms.hologramTime.value = elapsed + decoy.timeOffset;
        decoy.material.uniforms.hologramImpact.value = Math.min(1, impact + flickerBoost);
        decoy.mixer?.update(dt);
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const decoy of decoys) {
        decoy.mixer?.stopAllAction();
        if (decoy.model) decoy.model.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
        decoy.root.removeFromParent();
        decoy.material.dispose();
      }
      decoys.length = 0;
      for (const geometry of sharedGeometries) geometry.dispose();
      sharedGeometries.length = 0;
      holder.removeFromParent();
    },
  };
}

export type Phase4Decoys = ReturnType<typeof createPhase4Decoys>;
