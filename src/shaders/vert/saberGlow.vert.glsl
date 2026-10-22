varying vec2 vUv;

#ifdef SABER_TRAIL
attribute float aFade;
varying float vFade;
#else
varying vec3 vNormal;
varying vec3 vView;
#endif

void main() {
  vUv = uv;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  #ifdef SABER_TRAIL
  vFade = aFade;
  #else
  vNormal = normalize(normalMatrix * normal);
  vView = -viewPosition.xyz;
  #endif
  gl_Position = projectionMatrix * viewPosition;
}