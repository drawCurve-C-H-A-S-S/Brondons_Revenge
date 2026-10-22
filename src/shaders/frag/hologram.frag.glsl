uniform float hologramTime;
uniform vec3 hologramColor;
uniform float hologramImpact;
varying vec3 hologramPosition;
varying vec3 hologramNormal;
void main() {
  vec3 viewDirection = normalize(cameraPosition - hologramPosition);
  float rim = pow(1.0 - abs(dot(normalize(hologramNormal), viewDirection)), 2.0);
  float scan = 0.5 + 0.5 * sin(hologramPosition.y * 120.0 - hologramTime * 7.0);
  float sweep = pow(0.5 + 0.5 * sin(hologramPosition.y * 6.0 - hologramTime * 1.6), 12.0);
  float flicker = 0.94 + 0.06 * sin(hologramTime * 19.0 + hologramPosition.y * 4.0);
  vec3 color = mix(hologramColor, vec3(0.58, 0.9, 1.0), rim * 0.65 + sweep * 0.2);
  float alpha = (0.3 + rim * 0.3 + scan * 0.08 + sweep * 0.15) * flicker;
  color = mix(color, vec3(0.65, 0.95, 1.0), hologramImpact * 0.8);
  gl_FragColor = vec4(color * (0.75 + scan * 0.18 + rim * 0.5 + hologramImpact), min(1.0, alpha + hologramImpact * 0.35));
  #include <colorspace_fragment>
}