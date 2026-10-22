uniform sampler2D tDiffuse;
uniform sampler2D tFontAtlas;
uniform vec2 uGridSize;

varying vec2 vUv;

void main() {
  vec2 cellCoord = floor(vUv * uGridSize);
  vec2 cellLocal = fract(vUv * uGridSize);

  vec2 cellCenter = (cellCoord + 0.5) / uGridSize;
  vec4 cellColor = texture2D(tDiffuse, cellCenter);
  vec3 color = cellColor.rgb * 2.5;

  float lum = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  float charIdx;
  bool isNormalPixel = false;
  if (lum < 0.5) {
    charIdx = floor((lum / 0.5) * 3.999);
  } else if (lum < 0.95) {
    charIdx = 4.0 + floor(((lum - 0.5) / 0.45) * 2.999);
  } else {
    isNormalPixel = true;
  }

  vec3 charColor = vec3(color.r * 0.8, color.g, color.b * 0.8);

  if (isNormalPixel) {
    gl_FragColor = vec4(charColor, 1.0);
    return;
  }

  float charCount = 8.0;
  vec2 atlasUV = vec2(
    (charIdx + cellLocal.x) / charCount,
    cellLocal.y
  );
  float glyph = texture2D(tFontAtlas, atlasUV).r;

  vec3 bgColor = vec3(0.02, 0.02, 0.04);
  vec3 finalColor = mix(bgColor, charColor, step(0.15, glyph));

  gl_FragColor = vec4(finalColor, 1.0);
}
