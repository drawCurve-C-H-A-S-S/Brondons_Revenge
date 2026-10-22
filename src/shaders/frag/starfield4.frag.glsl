// Layer 4: 4 octaves, invert alpha, no ridge
uniform float uTime;
uniform vec3 uNoiseOffset;
uniform float uOpacity;

varying vec3 vDirection;

float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

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

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  value += amplitude * noise(p * frequency); amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * noise(p * frequency); amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * noise(p * frequency); amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * noise(p * frequency);
  return value;
}

void main() {
  if (uOpacity <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 dir = normalize(vDirection);
  vec3 pos = dir * 10.0 + uNoiseOffset;
  vec3 p1 = pos * 0.3;
  vec3 p2 = pos * 0.15 + 100.0;

  float warpX = fbm(p1 + vec3(13.1, 5.2, 1.7));
  float warpY = fbm(p1 + vec3(2.8, 17.3, 9.2));
  vec3 warped1 = p1 + (vec3(warpX - 0.5, warpY - 0.5, (warpX - warpY) * 0.5) * 0.5 * 2.0);
  float warp2 = fbm(p2 + vec3(8.0, 21.0, 3.0));
  vec3 warped2 = p2 + vec3(warp2 - 0.5, (warp2 - 0.5) * 0.4, 0.5 - warp2) * 0.5;

  float nebula = fbm(warped1);
  float nebula2 = fbm(warped2);
  float cloud = nebula * 0.7 + nebula2 * 0.3;

  float density = smoothstep(0.6, 0.68, cloud);
  float cloudAlpha = density * uOpacity;

  vec3 voidColor = vec3(0.006, 0.012, 0.035);
  vec3 color = voidColor;

  gl_FragColor = vec4(color, cloudAlpha);
}
