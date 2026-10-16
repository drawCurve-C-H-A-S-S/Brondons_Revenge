import * as THREE from 'three';
import anchorRingVertexShader from '../shaders/anchorRing.vert.glsl?raw';
import anchorRingFragmentShader from '../shaders/anchorRing.frag.glsl?raw';

/**
 * Phase 4 (Bay Warden zero-G barrage) hologram BOOT STATIONS — round 2b. Additive; only scene13 phase 4
 * ever constructs this. Replaces the old three-anchor / hold-E decoy deploy: there are now TWO floating
 * projector stations at opposite ends of the bay, each reached with the 3-axis zero-G controls and booted
 * by typing its target line in the terminal overlay. Booting BOTH makes the AI's overfit BRONDON-detection
 * model see more than one Brondon and break.
 *
 * Each station is a small procedural pedestal + projector emitter that reads dim/"OFF" until booted, then
 * lights up and plays host to a holographic decoy (planted by phase4Decoys at getProjectorPosition()).
 * The activation ring reuses the shared anchorRing shader: every tunable is injected as a GLSL #define
 * (buildRingShaderDefines) so the material keeps exactly the five animated uniforms
 * (uTime / uColor / uProximity / uProgress / uFlash). uProximity tracks the player's distance, uProgress
 * tracks the terminal typing fill, uFlash spikes on boot. Off-screen stations get an edge-clamped arrow
 * marker (the same inline vec.project(camera) pattern as phase4DetectionHud), hidden once booted.
 *
 * This module never imports mechBaymaxBoss: scene13 maps PHASE4_RULES onto the plain rules object below,
 * exactly like phase4Decoys. All per-frame work writes scalars into preallocated vectors; nothing allocates.
 */
export interface Phase4StationRules {
  count: number;
  // Station origins (world metres). getProjectorPosition() plants the hologram's feet here.
  stationX: readonly number[];
  stationY: readonly number[];
  stationZ: readonly number[];
  deployRadius: number;          // how close the player must float to boot (PRESS E)
  // Pedestal / projector visuals.
  pedestalColor: number;
  trimColor: number;
  emitterIdleColor: number;
  emitterActiveColor: number;
  emitterIdleIntensity: number;
  emitterActiveIntensity: number;
  coneColor: number;
  coneOpacity: number;
  // Activation-ring geometry + shader tunables (mirror PHASE4_RULES.ring*).
  ringRadius: number;
  ringTube: number;
  ringColor: number;
  ringHotColor: number;
  ringTimeOffset: number;
  ringProximityFalloff: number;
  ringFlashDecay: number;
  ringWobbleSegments: number;
  ringWobbleSpeed: number;
  ringWobbleAmp: number;
  ringWobbleProxBoost: number;
  ringDashCount: number;
  ringDashSpeed: number;
  ringProxGlow: number;
  ringEdgeSoft: number;
  ringIdleAlpha: number;
  ringProgressMix: number;
  ringProgressGain: number;
  ringProgressTip: number;
  ringFlashGain: number;
}

interface Station {
  root: THREE.Group;
  emitterMaterial: THREE.MeshStandardMaterial;
  cone: THREE.Mesh;
  coneMaterial: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMaterial: THREE.ShaderMaterial;
  marker: HTMLElement | null;
  arrow: HTMLElement | null;
  active: boolean;
  flash: number;
  progress: number;
  timeOffset: number;
}

// Inject every ring tunable as a GLSL #define prefix so the shader keeps exactly the five animated
// uniforms. Floats use toFixed(4) so they are valid GLSL float literals (a trailing .0). Moved here
// verbatim from scene13 so the station module owns its own visuals.
function buildRingShaderDefines(rules: Phase4StationRules): string {
  const f = (n: number) => Number(n).toFixed(4);
  const hot = new THREE.Color(rules.ringHotColor);
  return [
    '#define TAU 6.2831853',
    `#define RING_SEGMENTS ${f(rules.ringWobbleSegments)}`,
    `#define RING_WOBBLE_SPEED ${f(rules.ringWobbleSpeed)}`,
    `#define RING_WOBBLE_AMP ${f(rules.ringWobbleAmp)}`,
    `#define RING_WOBBLE_PROX_BOOST ${f(rules.ringWobbleProxBoost)}`,
    `#define RING_DASH_COUNT ${f(rules.ringDashCount)}`,
    `#define RING_DASH_SPEED ${f(rules.ringDashSpeed)}`,
    `#define RING_PROX_GLOW ${f(rules.ringProxGlow)}`,
    `#define RING_EDGE_SOFT ${f(rules.ringEdgeSoft)}`,
    `#define RING_IDLE_ALPHA ${f(rules.ringIdleAlpha)}`,
    `#define RING_PROGRESS_MIX ${f(rules.ringProgressMix)}`,
    `#define RING_PROGRESS_GAIN ${f(rules.ringProgressGain)}`,
    `#define RING_PROGRESS_TIP ${f(rules.ringProgressTip)}`,
    `#define RING_FLASH_GAIN ${f(rules.ringFlashGain)}`,
    `#define HOT_COLOR vec3(${hot.r.toFixed(4)}, ${hot.g.toFixed(4)}, ${hot.b.toFixed(4)})`,
    '',
  ].join('\n');
}

export function createPhase4Stations({ scene, camera, rules, markerContainer = null }: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  rules: Phase4StationRules;
  markerContainer?: HTMLElement | null;
}) {
  const holder = new THREE.Group(); holder.name = 'Phase4Stations'; holder.userData.minimap = false; scene.add(holder);
  const stations: Station[] = [];

  // Shared geometry (disposed once here, not per station) + the ring shader defines built from the rules.
  const pedestalGeometry = new THREE.CylinderGeometry(0.34, 0.56, 1.3, 20);
  const baseGeometry = new THREE.CylinderGeometry(0.58, 0.62, 0.14, 20);
  const emitterGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 28);
  const trimGeometry = new THREE.TorusGeometry(0.42, 0.035, 8, 28);
  const coneGeometry = new THREE.CylinderGeometry(0.46, 1.15, 2.7, 26, 1, true);
  const ringGeometry = new THREE.TorusGeometry(rules.ringRadius, rules.ringTube, 8, 40);
  const pedestalMaterial = new THREE.MeshStandardMaterial({ color: rules.pedestalColor, metalness: 0.7, roughness: 0.42 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: rules.trimColor, emissive: rules.trimColor, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.5 });
  const ringDefines = buildRingShaderDefines(rules);
  // Prototype ring material; each station clones it so all rings animate independently (clone deep-copies uniforms).
  const ringMaterialProto = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uColor: { value: new THREE.Color(rules.ringColor) },
      uProximity: { value: 0 }, uProgress: { value: 0 }, uFlash: { value: 0 },
    },
    vertexShader: ringDefines + anchorRingVertexShader, fragmentShader: ringDefines + anchorRingFragmentShader,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  let elapsed = 0, disposed = false;
  const _markerProbe = new THREE.Vector3();

  for (let i = 0; i < rules.count; i++) {
    const root = new THREE.Group();
    root.name = `Phase4Station-${i}`;
    root.position.set(rules.stationX[i] ?? 0, rules.stationY[i] ?? 0, rules.stationZ[i] ?? 0);
    root.userData.minimap = false;
    holder.add(root);

    // Pedestal hangs BELOW the origin; the emitter lens sits AT the origin so the hologram stands on it.
    const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    pedestal.position.y = -0.72; pedestal.castShadow = false; pedestal.receiveShadow = false; root.add(pedestal);
    const base = new THREE.Mesh(baseGeometry, pedestalMaterial); base.position.y = -1.4; root.add(base);
    const trim = new THREE.Mesh(trimGeometry, trimMaterial); trim.rotation.x = Math.PI / 2; trim.position.y = -0.2; root.add(trim);

    // Projector emitter lens: dim/"OFF" until booted, then bright.
    const emitterMaterial = new THREE.MeshStandardMaterial({
      color: rules.emitterIdleColor, emissive: rules.emitterIdleColor, emissiveIntensity: rules.emitterIdleIntensity,
      metalness: 0.3, roughness: 0.35,
    });
    const emitter = new THREE.Mesh(emitterGeometry, emitterMaterial); emitter.position.y = 0; root.add(emitter);

    // Faint additive projection cone, revealed only once the station is booting a hologram.
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: rules.coneColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(coneGeometry, coneMaterial); cone.position.y = 1.35; cone.visible = false; root.add(cone);

    // Activation ring (shared anchorRing shader), horizontal around the emitter.
    const ringMaterial = ringMaterialProto.clone();
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.name = `Phase4StationRing-${i}`; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    ring.frustumCulled = false; ring.userData.minimap = false; root.add(ring);

    // Edge-clamped arrow marker (DOM), created into the optional container.
    let marker: HTMLElement | null = null, arrow: HTMLElement | null = null;
    if (markerContainer) {
      marker = document.createElement('div');
      marker.className = 'p4-station-marker hidden';
      marker.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;'
        + 'align-items:center;gap:4px;pointer-events:none;will-change:left,top;';
      arrow = document.createElement('span');
      // A CSS border-triangle pointing right at 0deg (no font dependency), rotated toward the station.
      arrow.style.cssText = 'width:0;height:0;border-left:14px solid #7fe3ff;border-top:8px solid transparent;'
        + 'border-bottom:8px solid transparent;filter:drop-shadow(0 0 6px rgba(120,225,255,.9));transition:opacity .12s;';
      const label = document.createElement('span');
      label.textContent = `STATION ${i + 1}`;
      label.style.cssText = 'font:700 10px/1 ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;letter-spacing:.14em;'
        + 'color:#bff0ff;text-shadow:0 0 8px rgba(80,200,255,.85);white-space:nowrap;';
      marker.appendChild(arrow); marker.appendChild(label);
      markerContainer.appendChild(marker);
    }

    stations.push({
      root, emitterMaterial, cone, coneMaterial, ring, ringMaterial, marker, arrow,
      active: false, flash: 0, progress: 0, timeOffset: i * rules.ringTimeOffset,
    });
  }

  function applyActiveLook(station: Station) {
    station.emitterMaterial.color.setHex(station.active ? rules.emitterActiveColor : rules.emitterIdleColor);
    station.emitterMaterial.emissive.setHex(station.active ? rules.emitterActiveColor : rules.emitterIdleColor);
    station.emitterMaterial.emissiveIntensity = station.active ? rules.emitterActiveIntensity : rules.emitterIdleIntensity;
    station.cone.visible = station.active;
  }
  for (const station of stations) applyActiveLook(station);

  return {
    get count() { return rules.count; },
    /** Live world origin of a station (also the hologram plant point). Returns the internal vector. */
    getPosition(index: number) { return stations[index].root.position; },
    /** Write the hologram plant point (the emitter lens) into `out`. */
    getProjectorPosition(index: number, out: THREE.Vector3) { return out.copy(stations[index].root.position); },
    isActive(index: number) { return stations[index]?.active === true; },
    activeCount() { let n = 0; for (const s of stations) if (s.active) n++; return n; },
    /** Boot a station: light the emitter, reveal the projection cone, spike the ring flash. Idempotent. */
    activate(index: number) {
      const station = stations[index];
      if (!station || station.active) return false;
      station.active = true; station.flash = 1;
      applyActiveLook(station);
      if (station.marker) station.marker.classList.add('hidden');
      return true;
    },
    /** Every station back to OFF (used on the blind-window return; the trapped/O2 retry keeps them). */
    resetAll() {
      for (const station of stations) {
        station.active = false; station.flash = 0; station.progress = 0;
        applyActiveLook(station);
      }
    },
    /** Typing fill (0..1) for one station's activation ring; persists so kept progress shows while closed. */
    setProgress(index: number, value: number) {
      const station = stations[index];
      if (station) station.progress = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    },
    /** Nearest INACTIVE station within `radius` of `position` (3-D), or -1. Scalars only; no allocation. */
    nearestWithin(position: THREE.Vector3, radius: number) {
      let best = radius, found = -1;
      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];
        if (station.active) continue;
        const o = station.root.position;
        const d = Math.hypot(position.x - o.x, position.y - o.y, position.z - o.z);
        if (d < best) { best = d; found = i; }
      }
      return found;
    },
    /**
     * Drive the ring uniforms + arrow markers. `playerPos` feeds uProximity; `visible` gates the whole
     * subsystem (false outside the phase-4 barrage). Never allocates.
     */
    update(dt: number, playerPos: THREE.Vector3, visible: boolean) {
      if (disposed) return;
      elapsed += dt;
      const width = window.innerWidth, height = window.innerHeight;
      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];
        const origin = station.root.position;
        // Ring flash spikes to 1 on boot and decays fast.
        if (station.flash > 0) station.flash = Math.max(0, station.flash - dt * rules.ringFlashDecay);
        const u = station.ringMaterial.uniforms;
        u.uTime.value = elapsed + station.timeOffset;
        // uProximity: 1 inside deployRadius, ramping to 0 over ringProximityFalloff beyond it.
        const dist = Math.hypot(playerPos.x - origin.x, playerPos.y - origin.y, playerPos.z - origin.z);
        u.uProximity.value = !station.active && dist <= rules.deployRadius ? 1
          : THREE.MathUtils.clamp(1 - (dist - rules.deployRadius) / Math.max(0.0001, rules.ringProximityFalloff), 0, 1);
        // uProgress only fills an un-booted station; uFlash is the boot pulse.
        u.uProgress.value = station.active ? 0 : station.progress;
        u.uFlash.value = station.flash;
        // The activation ring is only meaningful before boot; hide it once the hologram owns the pad.
        station.ring.visible = visible && !station.active;
        // A booted station gently pulses its projection cone.
        if (station.active) station.coneMaterial.opacity = rules.coneOpacity * (0.75 + 0.25 * Math.sin(elapsed * 2.4 + station.timeOffset));

        // --- Arrow marker: point at an OFF station, clamped to the screen edge when off-screen. ---
        const marker = station.marker;
        if (!marker) continue;
        const show = visible && !station.active;
        if (!show) { if (!marker.classList.contains('hidden')) marker.classList.add('hidden'); continue; }
        marker.classList.remove('hidden');
        _markerProbe.copy(origin); _markerProbe.y += 0.5; _markerProbe.project(camera);
        const behind = _markerProbe.z > 1;
        // Behind the camera, project() mirrors the point; flip it back so the marker hugs the correct edge.
        const px = behind ? -_markerProbe.x : _markerProbe.x;
        const py = behind ? -_markerProbe.y : _markerProbe.y;
        const onScreen = !behind && Math.abs(px) <= 1 && Math.abs(py) <= 1;
        const m = 0.14;   // keep markers 14% inside the frame so they never sit under the bezel
        const cx = Math.max(-1 + m, Math.min(1 - m, px));
        const cy = Math.max(-1 + m, Math.min(1 - m, py));
        const sx = (cx + 1) * 0.5 * width, sy = (1 - cy) * 0.5 * height;
        marker.style.left = `${sx}px`; marker.style.top = `${sy}px`;
        if (station.arrow) {
          if (onScreen) {
            station.arrow.style.opacity = '0';   // sitting on the station: no direction needed
          } else {
            const tx = (px + 1) * 0.5 * width, ty = (1 - py) * 0.5 * height;
            const angle = Math.atan2(ty - sy, tx - sx) * 180 / Math.PI;
            station.arrow.style.opacity = '1';
            station.arrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
          }
        }
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const station of stations) {
        station.marker?.remove();
        station.ringMaterial.dispose();
        station.emitterMaterial.dispose();
        station.coneMaterial.dispose();
        station.root.removeFromParent();
      }
      stations.length = 0;
      ringMaterialProto.dispose();
      pedestalGeometry.dispose(); baseGeometry.dispose(); emitterGeometry.dispose();
      trimGeometry.dispose(); coneGeometry.dispose(); ringGeometry.dispose();
      pedestalMaterial.dispose(); trimMaterial.dispose();
      holder.removeFromParent();
    },
  };
}

export type Phase4Stations = ReturnType<typeof createPhase4Stations>;
