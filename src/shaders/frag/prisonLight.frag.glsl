uniform float flowTime;
uniform float strength;
varying vec2 flowUv;
void main() {
  float angle = flowUv.x * 6.283185;
  float height = flowUv.y;
  float ribbons = pow(max(0.0, sin(angle * 6.0 + sin(height * 8.0 - flowTime) * 0.7)), 8.0);
  float rising = pow(max(0.0, sin(height * 18.0 - flowTime * 2.4 + angle)), 7.0);
  float fade = smoothstep(0.0, 0.12, height) * (1.0 - smoothstep(0.55, 1.0, height));
  vec3 color = mix(vec3(0.24, 0.62, 0.96), vec3(0.76, 0.91, 1.0), rising * 0.6);
  gl_FragColor = vec4(color, strength * fade * (0.08 + ribbons * 0.22 + rising * 0.06));
}
