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

void main() {
  vec3 dir = normalize(vDirection);
  vec3 pos = dir * 10.0 + uNoiseOffset; // scale for noise space, apply offset
  
  // Animate: slowly drift through noise field
  pos += vec3(uTime * 0.15, uTime * 0.08, uTime * 0.12);
  
  // Nebula clouds (FBM noise)
  float nebula = fbm(pos * 0.3);
  float nebula2 = fbm(pos * 0.15 + 100.0); // second layer for variation
  
  // Combine nebula layers
  float cloud = nebula * 0.7 + nebula2 * 0.3;
  
  // Base: dark void with colored cloud overlay
  vec3 voidColor = vec3(0.02, 0.01, 0.03);
  float cloudAlpha = smoothstep(0.35, 0.55, cloud) * uOpacity;
  if (uInvertAlpha) {
    cloudAlpha = smoothstep(0.55, 0.75, cloud) * uOpacity; // sparser
  }
  vec3 finalColor = uColor;
  if (uHasBlend) {
    float blendNoise = noise(pos * 0.4 + 300.0);
    finalColor = mix(uColor, uBlendColor, blendNoise);
  }
  vec3 color = mix(voidColor, finalColor, cloudAlpha / uOpacity);
  
  // Comic-style dithering
  if (uDither) {
    vec2 gridPos = vDirection.xy * 30.0; // larger grid for bigger dots
    float ditherPattern = fract(sin(dot(gridPos, vec2(12.9898, 78.233))) * 43758.5453);
    float threshold = 0.5 + (ditherPattern - 0.5) * 0.8; // more aggressive
    if (cloudAlpha < threshold * uOpacity) {
      color = vec3(0.0); // pure black
      cloudAlpha = 0.0;
    }
  }
  
  gl_FragColor = vec4(color, cloudAlpha);
}
