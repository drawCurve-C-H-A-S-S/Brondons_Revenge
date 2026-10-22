uniform float uTime;
uniform float uHeight;
uniform float uMode;
uniform float uPixelRatio;
uniform float uViewportHeight;
uniform vec4 uContact;
uniform float uContactHeight;
uniform float uContactStrength;

varying vec3 vWaterPosition;
varying vec3 vWaterNormal;
varying vec2 vFlowCoord;
varying vec2 vWaterUv;
varying float vSprayFade;

#include <fog_pars_vertex>

#ifdef WATERFALL_SPRAY
attribute vec4 aSpray;
#endif
#ifdef WATERFALL_CHARACTER_SPLASH
attribute vec2 aDroplet;
#endif

void main() {
  vec3 displaced = position;
  vec3 localNormal = normal;
  vWaterUv = uv;
  vSprayFade = 1.0;
  #ifdef WATERFALL_CHARACTER_SPLASH
    localNormal = vec3(0.0, 1.0, 0.0);
    vSprayFade = aDroplet.y;
  #elif defined(WATERFALL_SPRAY)
    localNormal = vec3(0.0, 1.0, 0.0);
    float age = fract(uTime * 0.95 + aSpray.x);
    float flight = age * 1.2;
    displaced.x = (aSpray.y - 0.5) * 1.8 + flight * (0.8 + aSpray.w * 3.2);
    displaced.y = 0.12 + flight * (4.5 + aSpray.w * 3.5) - 4.91 * flight * flight;
    displaced.z = (aSpray.z - 0.5) * 15.0;
    vSprayFade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.5, 0.95, age));
  #else
    if (uMode < 0.5) {
      float down = (1.0 - uv.y) * uHeight;
      float fallTime = sqrt(2.0 * (down + 1.0) / 9.82);
      float phaseA = position.x * 1.7 + fallTime * 15.0 - uTime * 22.0;
      float phaseB = position.x * 4.3 - fallTime * 10.0 + uTime * 14.0;
      float amplitude = 0.06 + smoothstep(0.0, 1.0, down / uHeight) * 0.23;
      displaced.z += (sin(phaseA) + sin(phaseB) * 0.45) * amplitude;
      float slopeX = (cos(phaseA) * 1.7 + cos(phaseB) * 1.935) * amplitude;
      float slopeY = (-cos(phaseA) * 15.0 + cos(phaseB) * 4.5) * amplitude / (9.82 * fallTime);
      localNormal = normalize(vec3(-slopeX, -slopeY + 36.0 * uv.y / uHeight, 1.0));
      vFlowCoord = vec2(position.x, fallTime * 8.0 - uTime * 12.0);
    }
  #endif
  vec4 world = modelMatrix * vec4(displaced, 1.0);
  #if !defined(WATERFALL_SPRAY) && !defined(WATERFALL_CHARACTER_SPLASH)
    if (uMode < 0.5 && uContactStrength > 0.0) {
      vec2 bodyOffset = world.xz - uContact.xz;
      float contact = (1.0 - smoothstep(uContact.w * 0.5, uContact.w + 0.55, length(bodyOffset)))
        * smoothstep(uContact.y, uContact.y + 0.25, world.y)
        * (1.0 - smoothstep(uContact.y + uContactHeight * 0.72, uContact.y + uContactHeight + 0.12, world.y))
        * uContactStrength;
      world.x += (world.x < uContact.x ? -1.0 : 1.0) * contact * 0.32;
      world.z += bodyOffset.y / max(length(bodyOffset), 0.01) * contact * 0.18;
    }
  #endif
  vWaterPosition = world.xyz;
  vWaterNormal = normalize(mat3(modelMatrix) * localNormal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #ifdef WATERFALL_CHARACTER_SPLASH
    gl_PointSize = clamp(uPixelRatio * uViewportHeight * projectionMatrix[1][1] * aDroplet.x
      / max(1.0, -mvPosition.z), 1.0, 12.0);
  #elif defined(WATERFALL_SPRAY)
    gl_PointSize = clamp(uPixelRatio * (3.0 + aSpray.w * 5.0) * 18.0 / max(1.0, -mvPosition.z), 1.0, 9.0);
  #endif
  #include <fog_vertex>
}
