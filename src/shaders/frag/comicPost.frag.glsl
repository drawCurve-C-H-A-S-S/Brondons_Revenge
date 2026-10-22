// Full-screen comic/cel-shading post-process (Void Bastards style):
// posterized flat color bands, Sobel ink outlines, and halftone dot shading.
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uPosterizeLevels;
uniform float uEdgeStrength;
uniform float uHalftoneScale;

varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Sobel operator on luminance for crisp ink-style silhouette/detail lines.
float sobelEdge(vec2 uv, vec2 texel) {
  float tl = luma(texture2D(tDiffuse, uv + texel * vec2(-1.0,  1.0)).rgb);
  float t  = luma(texture2D(tDiffuse, uv + texel * vec2( 0.0,  1.0)).rgb);
  float tr = luma(texture2D(tDiffuse, uv + texel * vec2( 1.0,  1.0)).rgb);
  float l  = luma(texture2D(tDiffuse, uv + texel * vec2(-1.0,  0.0)).rgb);
  float r  = luma(texture2D(tDiffuse, uv + texel * vec2( 1.0,  0.0)).rgb);
  float bl = luma(texture2D(tDiffuse, uv + texel * vec2(-1.0, -1.0)).rgb);
  float b  = luma(texture2D(tDiffuse, uv + texel * vec2( 0.0, -1.0)).rgb);
  float br = luma(texture2D(tDiffuse, uv + texel * vec2( 1.0, -1.0)).rgb);

  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return sqrt(gx * gx + gy * gy);
}

// Screen-space ink dots, denser/larger in dark regions -- classic print-comic shading.
float halftoneDots(vec2 fragCoord, float darkness) {
  float angle = 0.785398; // 45 degrees, traditional halftone screen angle
  vec2 rotated = vec2(
    fragCoord.x * cos(angle) - fragCoord.y * sin(angle),
    fragCoord.x * sin(angle) + fragCoord.y * cos(angle)
  );
  vec2 cell = rotated / uHalftoneScale;
  vec2 cellCenter = floor(cell) + 0.5;
  float dist = length(cell - cellCenter);
  float dotRadius = clamp(darkness, 0.0, 1.0) * 0.62;
  return 1.0 - smoothstep(dotRadius - 0.08, dotRadius + 0.08, dist);
}

void main() {
  vec2 texel = 1.0 / uResolution;
  vec3 color = texture2D(tDiffuse, vUv).rgb;

  // Flatten into comic-style color bands instead of smooth gradients.
  vec3 posterized = floor(color * uPosterizeLevels + 0.5) / uPosterizeLevels;

  // Punch up saturation/contrast so the flat bands read as bold comic colors.
  float gray = luma(posterized);
  vec3 saturated = mix(vec3(gray), posterized, 1.45);
  saturated = (saturated - 0.5) * 1.12 + 0.5;

  // Ink dots deepen the shadows without losing the flat-color look.
  float darkness = 1.0 - clamp(luma(saturated) * 1.4, 0.0, 1.0);
  float dots = halftoneDots(gl_FragCoord.xy, darkness);
  vec3 shaded = mix(saturated, saturated * 0.45, dots * step(0.12, darkness));

  // Bold black ink outlines along silhouette and detail edges.
  float edge = sobelEdge(vUv, texel);
  float outline = smoothstep(0.25, 0.5, edge * uEdgeStrength);
  vec3 finalColor = mix(shaded, vec3(0.02, 0.02, 0.03), outline);

  // Subtle panel vignette to sell the comic-page framing.
  vec2 centered = vUv - 0.5;
  float vignette = 1.0 - dot(centered, centered) * 0.55;
  finalColor *= vignette;

  gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
