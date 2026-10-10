uniform float uTime;
uniform float uHeight;
uniform float uMode;
uniform float uPixelRatio;

varying vec3 vWaterPosition;
varying vec3 vWaterNormal;
varying vec2 vFlowCoord;
varying vec2 vWaterUv;
varying float vSprayFade;

#include <fog_pars_vertex>

#ifdef WATERFALL_SPRAY
attribute vec4 aSpray;
#endif

void main() {
  vec3 displaced = position;
  vec3 localNormal = normal;
  vWaterUv = uv;
  vSprayFade = 1.0;
  #ifdef WATERFALL_SPRAY
    localNormal = vec3(0.0, 1.0, 0.0);
    float age = fract(uTime * 0.7 + aSpray.x);
    float flight = age * 1.35;
    displaced.x = (aSpray.y - 0.5) * 1.5 + flight * (0.4 + aSpray.w * 2.2);
    displaced.y = 0.12 + flight * (3.2 + aSpray.w * 3.2) - 4.91 * flight * flight;
    displaced.z = (aSpray.z - 0.5) * 15.0;
    vSprayFade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.5, 0.95, age));
  #else
    if (uMode < 0.5) {
      float down = (1.0 - uv.y) * uHeight;
      float fallTime = sqrt(2.0 * (down + 1.0) / 9.82);
      float phaseA = position.x * 1.7 + fallTime * 15.0 - uTime * 9.0;
      float phaseB = position.x * 4.3 - fallTime * 10.0 + uTime * 6.0;
      float amplitude = 0.035 + smoothstep(0.0, 1.0, down / uHeight) * 0.14;
      displaced.z += (sin(phaseA) + sin(phaseB) * 0.45) * amplitude;
      float slopeX = (cos(phaseA) * 1.7 + cos(phaseB) * 1.935) * amplitude;
      float slopeY = (-cos(phaseA) * 15.0 + cos(phaseB) * 4.5) * amplitude / (9.82 * fallTime);
      localNormal = normalize(vec3(-slopeX, -slopeY, 1.0));
      vFlowCoord = vec2(position.x, fallTime * 6.0 - uTime * 6.0);
    }
  #endif
  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWaterPosition = world.xyz;
  vWaterNormal = normalize(mat3(modelMatrix) * localNormal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #ifdef WATERFALL_SPRAY
    gl_PointSize = clamp(uPixelRatio * (3.0 + aSpray.w * 5.0) * 18.0 / max(1.0, -mvPosition.z), 1.0, 9.0);
  #endif
  #include <fog_vertex>
}
