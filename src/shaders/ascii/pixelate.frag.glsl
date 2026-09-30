// Night vision goggles post-processing shader
// Converts the scene to ASCII art with edge detection overlay

uniform sampler2D tFullRes;
uniform vec2 uGridSize;
uniform vec2 uFullResSize;
uniform sampler2D tFontAtlas;
uniform float uExposure;
uniform float uAttenuation;

varying vec2 vUv;

// Sobel edge detection operator
// Returns gradient vector (gx, gy) indicating edge strength and direction
vec2 sobel(sampler2D tex, vec2 uv, vec2 spacing) {
  float tl = length(texture2D(tex, uv + vec2(-spacing.x, spacing.y)).rgb);
  float tm = length(texture2D(tex, uv + vec2(0, spacing.y)).rgb);
  float tr = length(texture2D(tex, uv + vec2(spacing.x, spacing.y)).rgb);
  float ml = length(texture2D(tex, uv + vec2(-spacing.x, 0)).rgb);
  float mr = length(texture2D(tex, uv + vec2(spacing.x, 0)).rgb);
  float bl = length(texture2D(tex, uv + vec2(-spacing.x, -spacing.y)).rgb);
  float bm = length(texture2D(tex, uv + vec2(0, -spacing.y)).rgb);
  float br = length(texture2D(tex, uv + vec2(spacing.x, -spacing.y)).rgb);
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
  return vec2(gx, gy);
}

void main() {
  vec2 texelSize = 1.0 / uFullResSize;
  vec2 sobelResult = sobel(tFullRes, vUv, texelSize * 3.0);
  float edgeStrength = length(sobelResult);
  float edgeThreshold = 0.08;
  vec2 gridCell = floor(vUv * uGridSize);
  vec2 gridCenter = (gridCell + 0.5) / uGridSize;
  vec2 cellSize = 1.0 / uGridSize;

  // Average the current cell, not the neighboring cell, with a small dither offset.
  vec3 lowResColor = vec3(0.0);
  float hash = fract(sin(dot(gridCell, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 ditherOffset = (vec2(hash, fract(hash * 1.7)) - 0.5) * 0.025;
  for (int x = 0; x < 4; x++) {
    for (int y = 0; y < 4; y++) {
      vec2 offset = (vec2(float(x) + 0.5, float(y) + 0.5) / 4.0 - 0.5 + ditherOffset) * cellSize;
      lowResColor += texture2D(tFullRes, gridCenter + offset).rgb;
    }
  }
  lowResColor /= 16.0;
  lowResColor = pow(max(lowResColor * uExposure, vec3(0.0)), vec3(uAttenuation));
  float luminance = dot(lowResColor, vec3(0.299, 0.587, 0.114));

  float charIndex;
  if (luminance < 0.05) charIndex = 0.0;
  else if (luminance < 0.15) charIndex = 1.0;
  else if (luminance < 0.3) charIndex = 2.0;
  else if (luminance < 0.5) charIndex = 3.0;
  else if (luminance < 0.7) charIndex = 4.0;
  else if (luminance < 0.85) charIndex = 5.0;
  else charIndex = 6.0;

  float charCount = 11.0;
  vec2 cellUV = fract(vUv * uGridSize);
  vec2 atlasUV = vec2((charIndex + cellUV.x) / charCount, cellUV.y);
  vec4 charColor = texture2D(tFontAtlas, atlasUV);
  vec3 finalColor = lowResColor * charColor.rgb;
  finalColor.g *= 2.0;

  // Directional glyphs replace the brightness glyph along detected edges.
  if (edgeStrength > edgeThreshold) {
    float angle = atan(sobelResult.y, sobelResult.x);
    float absAngle = abs(angle);
    float directionChar;
    if (absAngle < 0.393 || absAngle > 2.749) directionChar = 7.0;
    else if (absAngle < 1.178) directionChar = 9.0;
    else if (absAngle < 1.963) directionChar = 8.0;
    else directionChar = 10.0;
    vec2 edgeAtlasUV = vec2((directionChar + cellUV.x) / charCount, cellUV.y);
    vec3 edgeCharColor = texture2D(tFontAtlas, edgeAtlasUV).rgb;
    float edgeIntensity = smoothstep(edgeThreshold, edgeThreshold + 0.1, edgeStrength);
    finalColor = mix(finalColor, vec3(0.0, 1.0, 0.0) * edgeCharColor, edgeIntensity);
  }
  gl_FragColor = vec4(finalColor, 1.0);
  #include <colorspace_fragment>
}
