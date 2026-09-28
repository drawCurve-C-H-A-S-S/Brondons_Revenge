uniform float uTime;
uniform float uRiverZ;
uniform float uHalfWidth;

varying vec3 vWaterPosition;
varying vec3 vWaterNormal;
varying float vWaveHeight;

#include <fog_pars_vertex>

void riverWave(vec2 p, vec2 direction, float frequency, float amplitude, float speed,
               inout float height, inout vec2 slope) {
  vec2 wave = normalize(direction) * frequency;
  float phase = dot(p, wave) + uTime * speed;
  height += sin(phase) * amplitude;
  slope += cos(phase) * amplitude * wave;
}

void main() {
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
  float height = 0.0;
  vec2 slope = vec2(0.0);
  riverWave(world.xz, vec2(1.0, 0.18), 1.05, 0.065, 1.4, height, slope);
  riverWave(world.xz, vec2(0.8, -0.6), 1.8, 0.032, 1.9, height, slope);
  riverWave(world.xz, vec2(0.35, 1.0), 2.7, 0.018, 1.3, height, slope);
  riverWave(world.xz, vec2(1.0, -0.12), 4.2, 0.008, 3.1, height, slope);

  float bankDistance = uHalfWidth - abs(world.z - uRiverZ);
  float bankFade = smoothstep(0.0, 0.8, bankDistance);
  float bankT = clamp(bankDistance / 0.8, 0.0, 1.0);
  float bankSlope = -sign(world.z - uRiverZ) * 6.0 * bankT * (1.0 - bankT) / 0.8;
  slope = slope * bankFade + vec2(0.0, height * bankSlope);
  world.y += height * bankFade;
  vWaveHeight = height;
  vWaterPosition = world;
  vWaterNormal = normalize(vec3(-slope.x, 1.0, -slope.y));

  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
