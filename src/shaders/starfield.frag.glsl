// Noise-based starfield - Star Nest aesthetic (no volumetric rendering)
// Uses FBM noise for nebula clouds and hash-based points for stars

uniform float uTime;
uniform vec3 uColor;
uniform vec3 uBlendColor;
uniform vec3 uNoiseOffset;
uniform float uOpacity;
uniform bool uInvertAlpha;
uniform int uOctaves;
uniform bool uHasBlend;
uniform bool uDither;
uniform float uRidgeStrength;
uniform float uWarpStrength;
uniform float uThresholdLow;
uniform float uThresholdHigh;
uniform vec3 uTint;
uniform vec3 uTint2;
uniform float uTintMix;

varying vec3 vDirection;

// Hash function for random values
float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

// Smooth noise
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float a = hash(i);
  float b = hash(i + vec3(1.0, 0.0, 0.0));
  float c = hash(i + vec3(0.0, 1.0, 0.0));
  float d = hash(i + vec3(1.0, 1.0, 0.0));
  float e = hash(i + vec3(0.0, 0.0, 1.0));
  float ff = hash(i + vec3(1.0, 0.0, 1.0));
  float g = hash(i + vec3(0.0, 1.0, 1.0));
  float h = hash(i + vec3(1.0, 1.0, 1.0));
  
  float x1 = mix(a, b, f.x);
  float x2 = mix(c, d, f.x);
  float x3 = mix(e, ff, f.x);
  float x4 = mix(g, h, f.x);
  float y1 = mix(x1, x2, f.y);
  float y2 = mix(x3, x4, f.y);
  return mix(y1, y2, f.z);
}

// Fractal Brownian Motion - layered noise for nebula
float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for (int i = 0; i < 8; i++) {
    if (i >= uOctaves) break;
    value += amplitude * noise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

// Ridge noise: sharp filaments instead of soft blobs
float ridgeNoise(vec3 p) {
  return 1.0 - abs(noise(p) * 2.0 - 1.0);
}

// Ridge FBM: layered ridge noise for structured detail
float ridgeFbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for (int i = 0; i < 8; i++) {
    if (i >= uOctaves) break;
    value += amplitude * ridgeNoise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

void main() {
  if (uOpacity <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 dir = normalize(vDirection);
  vec3 pos = dir * 10.0 + uNoiseOffset;
  vec3 drift = vec3(uTime * 0.022, uTime * 0.011, -uTime * 0.017);

  vec3 p1 = pos * 0.3;
  p1 += drift;
  vec3 p2 = pos * 0.15 + 100.0 - drift * 0.35;

  vec3 warpDrift = vec3(uTime * 0.008, -uTime * 0.006, uTime * 0.007);
  float warpX = fbm(p1 + vec3(13.1, 5.2, 1.7) + warpDrift);
  float warpY = fbm(p1 + vec3(2.8, 17.3, 9.2) - warpDrift * 0.8);
  vec3 warped1 = p1 + (vec3(warpX - 0.5, warpY - 0.5, (warpX - warpY) * 0.5) * uWarpStrength * 2.0);
  float warp2 = fbm(p2 + vec3(8.0, 21.0, 3.0) - warpDrift * 0.5);
  vec3 warped2 = p2 + vec3(warp2 - 0.5, (warp2 - 0.5) * 0.4, 0.5 - warp2) * uWarpStrength;

  float nebula = mix(fbm(warped1), ridgeFbm(warped1), uRidgeStrength);
  float nebula2 = fbm(warped2);
  float cloud = nebula * 0.7 + nebula2 * 0.3;

  float density = smoothstep(uThresholdLow, uThresholdHigh, cloud);
  if (uInvertAlpha) {
    density = smoothstep(uThresholdHigh, uThresholdHigh + 0.08, cloud);
  }
  float cloudAlpha = density * uOpacity;

  float colorField = fbm(pos * 0.08 + vec3(31.0, 12.0, 54.0) + vec3(0.0, uTime * 0.004, 0.0));
  float hue = smoothstep(0.22, 0.78, colorField);
  vec3 finalColor = uColor;
  if (uHasBlend) {
    finalColor = mix(uColor, uBlendColor, hue);
  }
  vec3 bluePurple = mix(vec3(0.035, 0.075, 0.24), vec3(0.24, 0.08, 0.43), hue);
  vec3 cloudColor = mix(finalColor, bluePurple, 0.45);
  vec3 softHighlight = mix(vec3(0.13, 0.25, 0.46), vec3(0.43, 0.25, 0.61), hue);
  cloudColor = mix(cloudColor, softHighlight, smoothstep(0.48, 0.92, density) * 0.45);
  cloudColor = mix(cloudColor, mix(uTint, uTint2, hue), uTintMix);
  vec3 voidColor = vec3(0.006, 0.012, 0.035);
  vec3 color = mix(voidColor, cloudColor, density);

  if (uDither) {
    vec2 gridPos = vDirection.xy * 30.0;
    float ditherPattern = fract(sin(dot(gridPos, vec2(12.9898, 78.233))) * 43758.5453);
    float threshold = 0.5 + (ditherPattern - 0.5) * 0.8;
    if (cloudAlpha < threshold * uOpacity) {
      color = vec3(0.0);
      cloudAlpha = 0.0;
    }
  }

  gl_FragColor = vec4(color, cloudAlpha);
}
