// anchorRing.vert.glsl — phase-4 decoy anchor ring, VERTEX stage.
// Runs once per vertex of the ring's TorusGeometry.
//
// A torus ships with a UV map we use as an address on the ring:
//   uv.x = 0..1 travelling once around the MAIN hoop (the big circle),
//   uv.y = 0..1 travelling around the tube's cross-section (the thin circle).
// Every animated effect is addressed by uv.x, so the vertex stage only forwards the
// UV and adds a small "energy wobble"; all colouring happens in the fragment stage.
//
// The symbols below (TAU, RING_*) are NOT uniforms. scene13 injects them as GLSL
// #defines built from PHASE4_RULES (see buildRingShaderDefines), so they are
// compile-time constants and stay fully tunable from one config object.

uniform float uTime;        // seconds, already offset per-ring so each ring animates on its own
uniform float uProximity;   // 0..1, how close the player is to this anchor (1 = inside deploy range)

varying vec2 vRingUv;       // the torus UV, handed straight to the fragment shader

void main() {
  // Pass the UV through untouched; the fragment shader reads uv.x/uv.y from it.
  vRingUv = uv;

  // --- Energy wobble -------------------------------------------------------
  // A sine wave travelling around the hoop. RING_SEGMENTS is how many wave lobes
  // fit around the ring (uv.x * TAU * RING_SEGMENTS); adding uTime * speed scrolls
  // the wave so the bumps look like they chase each other around the circle.
  float wave = sin(uv.x * TAU * RING_SEGMENTS + uTime * RING_WOBBLE_SPEED);

  // The wobble grows slightly as the player approaches, so an in-range ring
  // "hums" harder. uProximity is 0 when far and 1 inside the deploy radius.
  float amplitude = RING_WOBBLE_AMP * (1.0 + uProximity * RING_WOBBLE_PROX_BOOST);

  // Push the vertex out along its own surface normal by the wave amount.
  // `position` and `normal` are the standard per-vertex attributes Three provides.
  vec3 displaced = position + normal * (wave * amplitude);

  // Transform the displaced point into clip space using the model-view-projection
  // matrices Three injects for every ShaderMaterial.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
