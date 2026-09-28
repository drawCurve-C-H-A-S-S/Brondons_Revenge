uniform float uTime;
uniform float uRiverZ;
uniform float uHalfWidth;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyColor;
uniform vec3 uForestColor;
uniform vec3 uFoamColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform int uObstacleCount;
uniform vec4 uObstacles[24];

varying vec3 vWaterPosition;
varying vec3 vWaterNormal;
varying float vWaveHeight;

#include <common>
#include <fog_pars_fragment>

float riverHash(vec2 p) {
  vec3 h = fract(vec3(p.xyx) * 0.1031);
  h += dot(h, h.yzx + 33.33);
  return fract((h.x + h.y) * h.z);
}

// Value noise and its analytic gradient keep the ripples smooth without textures.
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

// An inexpensive reflected sky/canopy keeps the river reflective without another scene pass.
vec3 riverEnvironment(vec3 reflected, vec2 position) {
  float elevation = clamp(reflected.y, 0.0, 1.0);
  vec3 sky = mix(uSkyColor * 1.15, uSkyColor * vec3(0.65, 0.85, 1.08), sqrt(elevation));
  vec2 projection = reflected.xz / (0.3 + abs(reflected.y));
  float clouds = smoothstep(0.48, 0.78, riverFbm(projection * 1.5 + vec2(uTime * 0.006, 0.0)));
  sky = mix(sky, vec3(0.72, 0.79, 0.71), clouds * 0.28);
  float canopy = riverFbm(projection * 3.0 + position * 0.035);
  float treeLine = 1.0 - smoothstep(0.12 + canopy * 0.25, 0.48 + canopy * 0.25, elevation);
  return mix(sky, uForestColor * (0.65 + canopy * 1.1), treeLine * 0.85);
}

void main() {
  vec2 p = vWaterPosition.xz;
  vec2 current = p + vec2(uTime * 0.95, 0.0);
  float eddy = riverNoise(current * 0.16).x;
  vec2 flow = current + vec2(eddy * 1.2, sin(p.x * 0.12 + uTime * 0.25) * 0.22);
  vec3 rippleA = riverNoise(flow * vec2(2.1, 3.8));
  vec3 rippleB = riverNoise((p + vec2(uTime * 0.38, -uTime * 0.12)) * 7.2);
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float detail = 1.0 - smoothstep(0.08, 0.65, footprint);
  vec2 microSlope = rippleA.yz * vec2(0.17, 0.23) + rippleB.yz * 0.07 * detail;
  vec3 normal = normalize(vWaterNormal + vec3(-microSlope.x, 0.0, -microSlope.y) * detail);
  if (!gl_FrontFacing) normal = -normal;
  vec3 viewDirection = normalize(cameraPosition - vWaterPosition);

  float bankDistance = max(0.0, uHalfWidth - abs(p.y - uRiverZ));
  float edgeDistance = bankDistance;
  float wake = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= uObstacleCount) break;
    vec4 obstacle = uObstacles[i];
    vec2 local = p - obstacle.xy;
    if (abs(local.x) > obstacle.z + 10.0 || abs(local.y) > obstacle.w + 3.0) continue;
    vec2 radii = max(obstacle.zw, vec2(0.1));
    float k0 = length(local / radii);
    float k1 = length(local / (radii * radii));
    float distanceToRock = k0 * (k0 - 1.0) / max(k1, 0.001);
    edgeDistance = min(edgeDistance, max(0.0, distanceToRock));
    float downstream = -local.x - radii.x;
    float wakeWidth = radii.y + max(0.0, downstream) * 0.2;
    float wakeSides = 1.0 - smoothstep(0.05, 0.5, abs(abs(local.y) - wakeWidth));
    wake = max(wake, wakeSides * smoothstep(0.0, 0.8, downstream) * (1.0 - smoothstep(1.0, 9.0, downstream)));
  }

  float depth = mix(0.4, 3.0, smoothstep(0.0, 4.5, edgeDistance));
  depth += (riverNoise(p * 0.24).x - 0.5) * 0.25;
  vec3 transmission = exp(-vec3(0.8, 0.33, 0.24) * depth);
  vec3 waterColor = mix(uDeepColor, uShallowColor, transmission) * (0.85 + eddy * 0.25);

  // Refracted riverbed light patterns fade out in deeper water.
  vec2 bed = p * 2.1 + normal.xz * 1.8;
  float causticField = abs(sin(bed.x + sin(bed.y + uTime * 0.5))
    + sin(bed.y * 1.3 - uTime * 0.7) + sin(bed.x * 0.8 - bed.y * 1.1 + uTime * 0.4) * 0.5);
  float caustic = 1.0 - smoothstep(0.06, 0.17 + fwidth(causticField), causticField);
  waterColor += uShallowColor * caustic * exp(-depth * 0.85) * detail * 0.45;

  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float fresnel = 0.025 + 0.975 * pow(1.0 - facing, 5.0);
  vec3 reflection = riverEnvironment(reflect(-viewDirection, normal), p);
  vec3 color = mix(waterColor, reflection, fresnel * 0.88 + 0.1);
  vec3 halfDirection = normalize(viewDirection + uSunDirection);
  float roughness = 0.16 + min(0.22, length(fwidth(normal)));
  float exponent = 2.0 / (roughness * roughness) - 2.0;
  float sunHighlight = pow(max(dot(normal, halfDirection), 0.0), exponent);
  float sunFresnel = 0.025 + 0.975 * pow(1.0 - max(dot(viewDirection, halfDirection), 0.0), 5.0);
  color += uSunColor * sunHighlight * (exponent + 2.0) * sunFresnel * 0.18;
  color += uSunColor * pow(max(dot(normal, halfDirection), 0.0), 14.0) * 0.025;

  float foamNoise = riverFbm(flow * vec2(1.25, 3.8));
  float fringe = 1.0 - smoothstep(0.08, 0.85, edgeDistance + (foamNoise - 0.5) * 0.65);
  float shoreFoam = fringe * smoothstep(0.25, 0.62, foamNoise);
  float shorePulse = sin(edgeDistance * 10.0 - uTime * 2.3 + eddy * 5.0) * 0.5 + 0.5;
  shoreFoam += (1.0 - smoothstep(0.0, 1.5, edgeDistance)) * smoothstep(0.82, 0.98, shorePulse) * foamNoise * 0.18;
  float streakNoise = riverFbm(flow * vec2(0.28, 3.2));
  float streaks = smoothstep(0.68, 0.84, streakNoise) * (0.08 + wake * 0.55);
  float crestFoam = smoothstep(0.075, 0.115, vWaveHeight) * smoothstep(0.6, 0.82, foamNoise) * 0.2;
  float foam = clamp(shoreFoam + streaks + wake * smoothstep(0.4, 0.7, foamNoise) * 0.38 + crestFoam, 0.0, 0.9);
  color = mix(color, uFoamColor * (0.85 + foamNoise * 0.15), foam);

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
