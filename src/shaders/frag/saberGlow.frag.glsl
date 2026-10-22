uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;

#ifdef SABER_TRAIL
varying float vFade;
#else
varying vec3 vNormal;
varying vec3 vView;
#endif

void main() {
  float ends = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
  #ifdef SABER_TRAIL
  float alpha = vFade * ends * (0.3 + 0.7 * vUv.y) * uOpacity;
  #else
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float alpha = pow(facing, 2.6) * ends * uOpacity;
  #endif
  gl_FragColor = vec4(uTint, alpha);
  #include <colorspace_fragment>
}