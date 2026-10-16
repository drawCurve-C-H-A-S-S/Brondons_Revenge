// anchorRing.frag.glsl — phase-4 decoy anchor ring, FRAGMENT (pixel) stage.
// Runs once per pixel. Everything is addressed by uv.x = position around the hoop.
//
// We stack four looks and blend them ADDITIVELY (the material uses AdditiveBlending,
// so the GPU multiplies our rgb by our alpha and adds it to the frame):
//   1) a soft-edged base glow in uColor,
//   2) dashes chasing around the ring, faster + brighter as the player nears,
//   3) a progress arc (uv.x < uProgress) that burns white while you hold E,
//   4) a whole-ring white flash the instant a decoy deploys (uFlash).
//
// The RING_* symbols and HOT_COLOR are #defines injected from PHASE4_RULES by
// scene13 (buildRingShaderDefines) — compile-time constants, not uniforms.

uniform float uTime;        // seconds (per-ring offset) — scrolls the chasing dashes
uniform vec3  uColor;       // base ring colour, from PHASE4_RULES.ringColor
uniform float uProximity;   // 0..1 player closeness — speeds up + brightens the ring
uniform float uProgress;    // 0..1 hold-E fill — how much of the hoop is "charged"
uniform float uFlash;       // 0..1 deploy spike — set to 1 on plant, decays quickly

varying vec2 vRingUv;       // torus UV coming from the vertex shader

void main() {
  float around = vRingUv.x;   // 0..1 position around the main hoop
  float tube = vRingUv.y;     // 0..1 position around the tube cross-section

  // --- Soft edge across the tube -------------------------------------------
  // Brightest at the tube's outer centre (tube ~ 0.5), fading toward the seam at
  // the silhouette. This rounds the ring off instead of letting it look flat.
  float edge = 1.0 - abs(tube - 0.5) * 2.0;        // 1 at the centre, 0 at the seam
  edge = smoothstep(0.0, 1.0, edge);               // soften the falloff into a curve
  edge = mix(edge, 1.0, RING_EDGE_SOFT);           // RING_EDGE_SOFT flattens it back toward uniform

  // --- Chasing dashes ------------------------------------------------------
  // A repeating sawtooth scrolling around the hoop. Both its speed and brightness
  // scale with uProximity, so an in-range ring spins faster and glows hotter.
  float dashSpeed = RING_DASH_SPEED * (1.0 + uProximity * RING_PROX_GLOW);
  float dash = fract(around * RING_DASH_COUNT - uTime * dashSpeed);  // 0..1 within each dash cell
  dash = smoothstep(0.55, 1.0, dash);              // keep only the leading slice -> a bright dash
  float dashGlow = dash * (0.35 + uProximity * 0.9); // dim when idle, strong when the player is near

  // --- Base body -----------------------------------------------------------
  // A small constant so the ring is always faintly visible, lifted a little by
  // proximity. This is the "fades when idle" behaviour: far away it settles to
  // RING_IDLE_ALPHA and never fully disappears.
  float base = RING_IDLE_ALPHA + uProximity * 0.25;

  // --- Progress arc --------------------------------------------------------
  // inArc = 1 across the charged part of the hoop (uv.x at or below uProgress), else 0.
  float inArc = step(around, uProgress);
  // A bright leading tip right at the fill head makes the arc clearly read as "filling".
  float tip = (1.0 - smoothstep(0.0, 0.03, abs(around - uProgress))) * step(0.001, uProgress);

  // --- Assemble colour (hue) and alpha (brightness mask) -------------------
  // Because blending is additive we keep `col` as a pure colour and let `alpha`
  // carry the intensity; the GPU does col * alpha for us.
  vec3 col = uColor;                                                     // start from the ring colour
  col = mix(col, HOT_COLOR, clamp(inArc * RING_PROGRESS_MIX + tip, 0.0, 1.0)); // charged arc -> white
  col = mix(col, HOT_COLOR, clamp(uFlash, 0.0, 1.0));                   // deploy flash whitens the ring

  // Total brightness = idle body + dashes + charged arc + tip + flash.
  float presence = base + dashGlow + inArc * RING_PROGRESS_GAIN + tip * RING_PROGRESS_TIP + uFlash * RING_FLASH_GAIN;
  float alpha = clamp(presence, 0.0, 1.0) * edge;                       // mask by the soft tube edge

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>   // convert our linear colour into the renderer's output colour space
}
