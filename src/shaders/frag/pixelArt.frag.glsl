uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uPixelSize;
uniform float uStrength;

varying vec2 vUv;

float pixelLuminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float bayer2(vec2 point) {
  float x = mod(point.x, 2.0);
  float y = mod(point.y, 2.0);
  if (y < 1.0) return x < 1.0 ? 0.0 : 2.0;
  return x < 1.0 ? 3.0 : 1.0;
}

float bayer4(vec2 point) {
  vec2 cell = mod(point, 4.0);
  return bayer2(mod(cell, 2.0)) * 4.0 + bayer2(floor(cell * 0.5));
}

void main() {
  vec2 gridSize = max(floor(uResolution / max(uPixelSize, 1.0)), vec2(1.0));
  vec2 cell = floor(vUv * gridSize);
  vec2 pixelUv = (cell + 0.5) / gridSize;
  vec2 stepUv = 1.0 / gridSize;

  vec3 source = texture2D(uScene, vUv).rgb;
  vec3 color = texture2D(uScene, pixelUv).rgb;
  float levels = 12.0;
  float dither = (bayer4(cell) / 16.0 - 0.5) / levels;
  color = floor(clamp(color + dither, 0.0, 1.0) * levels + 0.5) / levels;

  float topLeft = pixelLuminance(texture2D(uScene, pixelUv + stepUv * vec2(-1.0, 1.0)).rgb);
  float top = pixelLuminance(texture2D(uScene, pixelUv + stepUv * vec2(0.0, 1.0)).rgb);
  float topRight = pixelLuminance(texture2D(uScene, pixelUv + stepUv).rgb);
  float left = pixelLuminance(texture2D(uScene, pixelUv - stepUv.x * vec2(1.0, 0.0)).rgb);
  float right = pixelLuminance(texture2D(uScene, pixelUv + stepUv.x * vec2(1.0, 0.0)).rgb);
  float bottomLeft = pixelLuminance(texture2D(uScene, pixelUv - stepUv).rgb);
  float bottom = pixelLuminance(texture2D(uScene, pixelUv - stepUv.y * vec2(0.0, 1.0)).rgb);
  float bottomRight = pixelLuminance(texture2D(uScene, pixelUv + stepUv * vec2(1.0, -1.0)).rgb);
  float edgeX = -topLeft + topRight - 2.0 * left + 2.0 * right - bottomLeft + bottomRight;
  float edgeY = -topLeft - 2.0 * top - topRight + bottomLeft + 2.0 * bottom + bottomRight;
  float outline = smoothstep(0.3, 0.9, length(vec2(edgeX, edgeY)));
  color *= 1.0 - outline * 0.42;

  gl_FragColor = vec4(mix(source, color, uStrength), 1.0);
  #include <colorspace_fragment>
}