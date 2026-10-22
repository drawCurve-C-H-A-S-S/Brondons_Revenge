uniform vec3 uColor;
uniform float uTime;
uniform float uAlert;
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  float thread = 0.82 + 0.18 * sin(vWorld.y * 18.0 + uTime * 2.0);
  float dust = 0.8 + 0.2 * sin(vWorld.x * 9.0 + vWorld.z * 7.0 - uTime);
  float fade = pow(1.0 - vUv.y, 0.6) * smoothstep(0.0, 0.12, vUv.y);
  vec3 color = mix(uColor, vec3(1.0, 0.1, 0.14), uAlert);
  gl_FragColor = vec4(color, fade * thread * dust * 0.12);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}