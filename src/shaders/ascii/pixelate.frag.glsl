// Night vision goggles post-processing shader
// Converts the scene to ASCII art with edge detection overlay

uniform sampler2D tFullRes;      // Full-resolution scene texture
uniform vec2 uGridSize;          // ASCII grid dimensions (width/height in characters)
uniform vec2 uFullResSize;       // Full resolution dimensions in pixels
uniform sampler2D tFontAtlas;    // Texture atlas containing ASCII characters
uniform float uExposure;         // Luminance exposure multiplier
uniform float uAttenuation;      // Luminance attenuation exponent

varying vec2 vUv;

// Sobel edge detection operator
// Returns gradient vector (gx, gy) indicating edge strength and direction
// The step parameter controls the sampling radius - larger values detect broader edges
vec2 sobel(sampler2D tex, vec2 uv, vec2 step) {
  // Sample 8 neighbors in a 3x3 grid
  float tl = length(texture2D(tex, uv + vec2(-step.x, step.y)).rgb);
  float tm = length(texture2D(tex, uv + vec2(0, step.y)).rgb);
  float tr = length(texture2D(tex, uv + vec2(step.x, step.y)).rgb);

  float ml = length(texture2D(tex, uv + vec2(-step.x, 0)).rgb);
  float mr = length(texture2D(tex, uv + vec2(step.x, 0)).rgb);

  float bl = length(texture2D(tex, uv + vec2(-step.x, -step.y)).rgb);
  float bm = length(texture2D(tex, uv + vec2(0, -step.y)).rgb);
  float br = length(texture2D(tex, uv + vec2(step.x, -step.y)).rgb);

  // Compute horizontal and vertical gradients
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;

  return vec2(gx, gy);
}

void main() {
  vec2 texelSize = 1.0 / uFullResSize;

  // Edge detection using Sobel operator with wider stencil (3x texel spacing)
  // This naturally captures broader edges without needing a separate blur pass
  vec2 sobelResult = sobel(tFullRes, vUv, texelSize * 3.0);
  float edgeStrength = length(sobelResult) * 1.0;
  float edgeThreshold = 0.08;  // Minimum edge strength to render

  // Calculate which ASCII grid cell this fragment belongs to
  vec2 gridCell = floor(vUv * uGridSize);
  vec2 gridCenter = (gridCell + 0.5) / uGridSize;

  // 4x4 box filter downscaling with dithering to prevent banding
  // Averages 16 samples from the full-res texture to get the color for this grid cell
  vec3 lowResColor = vec3(0.0);
  float samples = 0.0;
  vec2 cellSize = 1.0 / uGridSize;
  
  // Hash function for dithering offset
  float hash = fract(sin(dot(gridCell, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 ditherOffset = vec2(hash, fract(hash * 1.7)) * 0.25;
  
  for (float x = 0.0; x < 4.0; x++) {
    for (float y = 0.0; y < 4.0; y++) {
      vec2 offset = vec2((x + 0.5) / 4.0, (y + 0.5) / 4.0) * cellSize;
      offset += ditherOffset * cellSize * 0.1;  // Small random offset
      lowResColor += texture2D(tFullRes, gridCenter + offset).rgb;
      samples += 1.0;
    }
  }
  lowResColor = lowResColor / samples;

  // Apply exposure and attenuation for night vision amplification
  // Exposure multiplies brightness, attenuation controls the curve
  lowResColor = pow(lowResColor * uExposure, vec3(uAttenuation));

  // Convert to luminance for character selection
  float luminance = dot(lowResColor, vec3(0.299, 0.587, 0.114));

  // Map luminance to ASCII character index
  // Characters are ordered from darkest to brightest: . ; c o P ? @ ◼
  float charIndex;
  if (luminance < 0.05) charIndex = 0.0;       // .
  else if (luminance < 0.15) charIndex = 1.0;  // ;
  else if (luminance < 0.3) charIndex = 2.0;   // c
  else if (luminance < 0.5) charIndex = 3.0;   // o
  else if (luminance < 0.7) charIndex = 4.0;   // P
  else if (luminance < 0.85) charIndex = 5.0;  // ?
  else charIndex = 6.0;                        // @

  // Sample the character from the font atlas
  float charCount = 11.0;
  vec2 cellUV = fract(vUv * uGridSize);  // Position within the grid cell (0-1)
  vec2 atlasUV = vec2(
    (charIndex + cellUV.x) / charCount,
    cellUV.y  // Characters fill full atlas height
  );
  vec4 charColor = texture2D(tFontAtlas, atlasUV);

  // Apply character shape and boost green channel for night vision look
  vec3 finalColor = lowResColor * charColor.rgb;
  finalColor.g *= 2.0;

  // Edge overlay: render directional characters on detected edges
  if (edgeStrength > edgeThreshold) {
    // Use Sobel gradient angle to choose between 4 directional edge characters
    // Angle ranges: 0°=horizontal, 90°=vertical, ±45°=diagonals
    float angle = atan(sobelResult.y, sobelResult.x);
    float absAngle = abs(angle);

    float directionChar;
    if (absAngle < 0.393 || absAngle > 2.749) {
      directionChar = 7.0;  // ◼ for horizontal edges (0°)
    } else if (absAngle < 1.178) {
      directionChar = 9.0;  // / for diagonal edges (45°)
    } else if (absAngle < 1.963) {
      directionChar = 8.0;  // | for vertical edges (90°)
    } else {
      directionChar = 10.0; // \ for diagonal edges (135°)
    }

    // Sample the edge character from atlas
    vec2 edgeAtlasUV = vec2(
      (directionChar + cellUV.x) / charCount,
      cellUV.y  // Map cell Y to full atlas height
    );
    vec4 edgeCharColor = texture2D(tFontAtlas, edgeAtlasUV);

    // Edge completely replaces underlying character with black background
    float edgeIntensity = smoothstep(edgeThreshold, edgeThreshold + 0.1, edgeStrength);
    vec3 edgeColor = vec3(0.0, 1.0, 0.0) * edgeCharColor.rgb;  // Pure green edges
    finalColor = mix(finalColor, edgeColor, edgeIntensity);  // Full replacement, no blending
  }

  gl_FragColor = vec4(finalColor, charColor.a);
}
