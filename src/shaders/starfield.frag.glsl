// Noise-based starfield - Star Nest aesthetic (no volumetric rendering)
// Uses FBM noise for nebula clouds and hash-based points for stars

uniform float uTime;

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
  
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vDirection);
  vec3 pos = dir * 10.0; // scale for noise space
  
  // Animate: slowly drift through noise field
  pos += vec3(uTime * 0.15, uTime * 0.08, uTime * 0.12);
  
  // Nebula clouds (FBM noise)
  float nebula = fbm(pos * 0.3);
  float nebula2 = fbm(pos * 0.15 + 100.0); // second layer for variation
  
  // Combine nebula layers
  float cloud = nebula * 0.7 + nebula2 * 0.3;
  
  // Stars (high-frequency noise with sharp threshold)
  float stars = noise(pos * 4.0);
  float starMask = smoothstep(0.92, 0.96, stars);
  
  // Bright stars (rarer, brighter)
  float brightStars = noise(pos * 2.0 + 50.0);
  float brightStarMask = smoothstep(0.94, 0.97, brightStars);
  
  // Color palette: dark void → muted purple/orange/red nebula → pink highlights → white stars
  vec3 voidColor = vec3(0.02, 0.01, 0.03);
  vec3 purpleColor = vec3(0.25, 0.18, 0.28); // muted purple
  vec3 orangeColor = vec3(0.35, 0.22, 0.15); // muted orange
  vec3 redColor = vec3(0.30, 0.15, 0.18); // muted red
  vec3 highlightColor = vec3(0.45, 0.30, 0.40); // muted pink-purple
  vec3 starColor = vec3(1.0, 0.95, 0.90); // warm white
  
  // Color variation based on position (smooth blending between colors)
  float colorRegion = noise(pos * 0.4 + 300.0);
  float purpleWeight = smoothstep(0.66, 0.33, colorRegion);
  float orangeWeight = smoothstep(0.33, 0.0, colorRegion) * smoothstep(0.66, 1.0, colorRegion);
  float redWeight = smoothstep(0.33, 0.66, colorRegion);
  vec3 nebulaBase = purpleColor * purpleWeight + orangeColor * orangeWeight + redColor * redWeight;
  nebulaBase = normalize(nebulaBase + 0.001) * length(nebulaBase); // normalize to prevent oversaturation
  
  // Base: void with nebula overlay (semi-transparent clouds)
  vec3 color = voidColor;
  float cloudAlpha = smoothstep(0.35, 0.55, cloud) * 0.5; // 50% max opacity
  color = mix(color, nebulaBase, cloudAlpha);
  
  // Pink highlights on dense clouds
  float highlightAlpha = smoothstep(0.50, 0.70, cloud) * 0.3;
  color = mix(color, highlightColor, highlightAlpha);
  
  // Subtle color variation based on position
  float colorVar = noise(pos * 0.5 + 200.0);
  color = mix(color, color * vec3(0.9, 0.85, 1.0), colorVar * 0.3);
  
  gl_FragColor = vec4(color, 1.0);
}
