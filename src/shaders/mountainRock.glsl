float rockHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float rockNoise(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rockHash(cell), rockHash(cell + vec3(1, 0, 0)), f.x),
        mix(rockHash(cell + vec3(0, 1, 0)), rockHash(cell + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(rockHash(cell + vec3(0, 0, 1)), rockHash(cell + vec3(1, 0, 1)), f.x),
        mix(rockHash(cell + vec3(0, 1, 1)), rockHash(cell + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 mountainSurface(vec3 world) {
  float coarse = rockNoise(world * 0.18);
  float grain = rockNoise(world * 2.8);
  float fine = rockNoise(world * 13.0);
  float strata = abs(sin(world.y * 1.05 + coarse * 4.8 + world.z * 0.08));
  float cracks = 1.0 - smoothstep(0.035, 0.16, strata);
  float wet = (1.0 - smoothstep(2.0, 16.0, world.y)) * (1.0 - smoothstep(4.0, 12.0, abs(world.z - 17.0)));
  float moss = smoothstep(0.5, 0.78, rockNoise(world * 0.5 + vec3(19.0))) * (1.0 - smoothstep(0.0, 32.0, world.y));
  vec3 stone = mix(vec3(0.33, 0.36, 0.39), vec3(0.76, 0.72, 0.63), coarse * 0.7 + grain * 0.3);
  stone *= 0.78 + fine * 0.3;
  stone = mix(stone, vec3(0.18, 0.2, 0.22), cracks * 0.65);
  stone = mix(stone, vec3(0.24, 0.31, 0.17), moss * 0.55);
  return stone * (1.0 - wet * 0.25);
}

float mountainBump(vec3 world) {
  float grain = rockNoise(world * 2.8);
  float coarse = rockNoise(world * 0.18);
  float strata = abs(sin(world.y * 1.05 + coarse * 4.8 + world.z * 0.08));
  return grain * 0.085 + strata * 0.06;
}
