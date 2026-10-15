float riverHash(vec2 p) {
  vec3 h = fract(vec3(p.xyx) * 0.1031);
  h += dot(h, h.yzx + 33.33);
  return fract((h.x + h.y) * h.z);
}

vec3 riverNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  vec2 blend = f * f * (3.0 - 2.0 * f);
  vec2 derivative = 6.0 * f * (1.0 - f);
  float a = riverHash(cell);
  float b = riverHash(cell + vec2(1.0, 0.0));
  float c = riverHash(cell + vec2(0.0, 1.0));
  float d = riverHash(cell + vec2(1.0, 1.0));
  float crossTerm = a - b - c + d;
  return vec3(a + (b - a) * blend.x + (c - a) * blend.y + crossTerm * blend.x * blend.y,
              derivative * (vec2(b - a, c - a) + crossTerm * blend.yx));
}

float riverFbm(vec2 p) {
  float value = riverNoise(p).x * 0.57;
  p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3;
  value += riverNoise(p).x * 0.28;
  return value + riverNoise(p * 2.03 + 8.7).x * 0.15;
}
