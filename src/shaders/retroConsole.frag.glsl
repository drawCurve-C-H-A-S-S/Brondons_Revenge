uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uStrength;

varying vec2 vUv;

float bayer2(vec2 pixel) {
  float x = mod(pixel.x, 2.0);
  float y = mod(pixel.y, 2.0);
  if (y < 1.0) return x < 1.0 ? 0.0 : 2.0;
  return x < 1.0 ? 3.0 : 1.0;
}

void main() {
  vec3 source = texture2D(uScene, vUv).rgb;
  float luma = dot(source, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = mix(vec3(luma), source, 1.16);
  color = (color - 0.5) * 1.04 + 0.51;
  color = clamp(color, 0.0, 1.0);

  vec2 pixel = floor(vUv * uResolution);
  float dither = (bayer2(pixel) / 4.0 - 0.375);
  vec3 levels = vec3(31.0, 63.0, 31.0);
  vec3 consoleColor = floor(clamp(color + dither / levels, 0.0, 1.0) * levels + 0.5) / levels;
  float scanline = 0.985 + 0.015 * cos(pixel.y * 3.14159265);
  consoleColor *= scanline;

  gl_FragColor = vec4(mix(source, consoleColor, uStrength), 1.0);
  #include <colorspace_fragment>
}