// Procedural fire-ball fragment shader.
// A sphere of radius 1 rendered additively: core is white-hot, edges churn into ember red and smoke.
// uProgress runs 0..1 across the explosion lifetime; the ball inflates, cools, and dissipates.
precision highp float;

varying vec3 vLocal;
varying vec3 vViewDir;

uniform float uTime;
uniform float uProgress;
uniform float uIntensity;
uniform vec3 uCameraLocal;
uniform vec3 uColorCore;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;
uniform vec3 uColorSmoke;

// Cheap 3D hash for value noise.
float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.333);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

float fbm(vec3 p) {
  float total = 0.0;
  float amp = 0.55;
  float freq = 1.0;
  for (int i = 0; i < 3; i++) {
    total += valueNoise(p * freq) * amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return total;
}

void main() {
  // Integrate through the volume: surface-only radius is always one on a sphere.
  vec3 ray = normalize(vLocal - uCameraLocal);
  float b = dot(uCameraLocal, ray);
  float discriminant = b * b - dot(uCameraLocal, uCameraLocal) + 1.0;
  if (discriminant <= 0.0) discard;
  float nearT = max(0.0, -b - sqrt(discriminant));
  float farT = -b + sqrt(discriminant);
  float stepSize = (farT - nearT) / 18.0;
  float transmittance = 1.0;
  vec3 radiance = vec3(0.0);
  float cooling = smoothstep(0.18, 0.95, uProgress);
  float jitter = hash(vec3(gl_FragCoord.xy, 1.0));
  for (int i = 0; i < 18; i++) {
    vec3 p = uCameraLocal + ray * (nearT + (float(i) + jitter) * stepSize);
    vec3 flow = p * 4.5 - vec3(0.0, uTime * 2.4, 0.0);
    float curl = fbm(flow + fbm(flow * 0.55) * 1.5);
    float radius = length(p * vec3(1.0, 0.92, 1.0));
    float envelope = 1.0 - smoothstep(0.35, 1.0, radius);
    float density = max(0.0, curl - 0.22) * envelope * 9.0;
    float heat = clamp((1.0 - radius) * 1.4 + curl * 0.75 - cooling * 0.85, 0.0, 1.0);
    vec3 flame = mix(uColorEdge, uColorMid, smoothstep(0.1, 0.65, heat));
    flame = mix(flame, uColorCore, smoothstep(0.6, 0.95, heat));
    flame = mix(uColorSmoke, flame, smoothstep(0.02, 0.35, heat));
    float absorption = 1.0 - exp(-density * stepSize * 2.4);
    radiance += transmittance * absorption * flame * (1.3 + heat * 2.8);
    transmittance *= 1.0 - absorption;
    if (transmittance < 0.02) break;
  }
  float alpha = (1.0 - transmittance) * (1.0 - smoothstep(0.68, 1.0, uProgress));
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(radiance * uIntensity, alpha);
}
