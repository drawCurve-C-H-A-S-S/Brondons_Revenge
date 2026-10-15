// Corroded, glow-veined rust. World-space noise so the pattern stays put on any prop orientation.
uniform vec3 uBaseColor;
uniform vec3 uRustColor;
uniform vec3 uEmissiveColor;
uniform vec3 uLightDirection;
uniform vec3 uFillDirection;
uniform float uTime;
uniform float uRoughness;
uniform float uEmissiveIntensity;
uniform float uDamageStage;
uniform float uHitFlash;
uniform float uScale;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
               mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    amplitude *= 0.5;
  }
  return value;
}

float ridged(vec3 p) {
  float r = 1.0 - abs(noise(p) * 2.0 - 1.0);
  r *= 0.5 + 0.5 * (1.0 - abs(noise(p * 2.7 + 5.0) * 2.0 - 1.0));
  return r;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  vec3 world = vWorldPosition * uScale;

  // Corrosion patches with pitted holes and flaked edges.
  float patches = fbm(world);
  float rust = smoothstep(0.32, 0.55, patches);
  float pits = smoothstep(0.56, 0.74, fbm(world * 2.7 + 11.0));
  float edge = smoothstep(0.38, 0.46, patches) * (1.0 - smoothstep(0.50, 0.60, patches));

  vec3 rustCol = mix(uRustColor * 0.72, uRustColor, fbm(world * 5.0));
  vec3 albedo = mix(uBaseColor, rustCol, rust);
  albedo = mix(albedo, vec3(0.045, 0.035, 0.03), pits * 0.85);
  albedo += edge * vec3(0.22, 0.14, 0.07);

  // Fine grain and vertical runoff streaks break up the flat panels.
  float micro = noise(world * 13.0) - 0.5;
  albedo *= 1.0 + micro * 0.22;
  float streak = smoothstep(0.62, 0.9, noise(vec3(world.x * 7.0, world.y * 1.1, world.z * 7.0)));
  albedo *= 1.0 - streak * rust * 0.35;

  // Damage cracks deepen with each heavy hit; stage 0 shows none.
  float crackField = ridged(world * 2.2 + 7.0);
  float crackTop = 0.93 - 0.11 * min(uDamageStage, 2.0);
  float cracks = smoothstep(crackTop - 0.05, crackTop + 0.01, crackField) * step(0.5, uDamageStage);
  albedo *= 1.0 - cracks * 0.6;

  // Key + fill fake lighting; roughness kills the spec on rusted areas.
  vec3 keyDir = normalize(uLightDirection);
  vec3 fillDir = normalize(uFillDirection);
  float diffuse = max(dot(normal, keyDir), 0.0) * 0.75 + max(dot(normal, fillDir), 0.0) * 0.22 + 0.32;
  float rough = clamp(mix(uRoughness, 1.0, rust), 0.0, 1.0);
  float specPower = mix(48.0, 5.0, rough);
  vec3 halfVec = normalize(keyDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), specPower) * (1.0 - rough) * 0.35;

  float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0) * 0.3;

  vec3 color = albedo * diffuse + vec3(spec) + uEmissiveColor * rim * (0.3 + rust * 0.7);

  // Glow lives in the corrosion veins, hot pit centers and open cracks - and never goes fully dark,
  // so a breakable can never roll an unlucky noise patch and read as plain metal.
  float veins = 0.45 + pow(rust, 2.0) * 0.55 + pits * 0.9 + cracks * (uDamageStage >= 2.0 ? 1.0 : 0.45);
  // Glow travels slowly along the veins; hot pits spit occasional ember sparkles.
  float travel = sin(uTime * 1.2 - (vWorldPosition.y * 2.0 + vWorldPosition.x * 1.1 + vWorldPosition.z * 0.7));
  float pulse = 0.86 + 0.14 * travel;
  color += uEmissiveColor * uEmissiveIntensity * veins * pulse;
  float sparkCell = floor(uTime * 5.0);
  float spark = step(0.988, hash(floor(vWorldPosition * 6.0) + vec3(sparkCell, sparkCell * 0.7, sparkCell * 1.3))) * pits;
  color += vec3(1.0, 0.72, 0.38) * spark * (0.5 + 0.5 * fract(uTime * 5.0)) * min(uEmissiveIntensity, 1.5);

  // Hit feedback flash.
  color += vec3(1.0, 0.92, 0.8) * uHitFlash;

  gl_FragColor = vec4(color, 1.0);
}
