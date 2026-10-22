// Comic book / Void Bastards style fragment shader
uniform vec3 uColor;
uniform vec3 uLightDirection;
uniform float uTime;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying vec3 vViewPosition;

// Toon shading with comic-style steps
vec3 toonShade(vec3 normal, vec3 lightDir) {
  float NdotL = dot(normal, lightDir);
  
  // Comic-style stepped lighting (3 tones)
  float intensity;
  if (NdotL > 0.5) {
    intensity = 1.0; // Highlight
  } else if (NdotL > 0.0) {
    intensity = 0.6; // Mid-tone
  } else if (NdotL > -0.3) {
    intensity = 0.3; // Shadow
  } else {
    intensity = 0.15; // Deep shadow
  }
  
  return uColor * intensity;
}

// Edge detection for comic outlines
float edgeDetect(vec3 normal, vec3 viewDir) {
  float edge = 1.0 - abs(dot(normal, viewDir));
  edge = smoothstep(0.4, 0.6, edge);
  return edge;
}

// Halftone pattern for shadows
float halftone(vec2 uv, float darkness) {
  vec2 cell = uv * 20.0;
  vec2 cellCenter = floor(cell) + 0.5;
  float dist = length(cell - cellCenter);
  float dotSize = darkness * 0.5;
  return step(dist, dotSize);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  vec3 lightDir = normalize(uLightDirection);
  
  // Base toon shading
  vec3 color = toonShade(normal, lightDir);
  
  // Add rim lighting for comic effect
  float rim = 1.0 - max(dot(normal, viewDir), 0.0);
  rim = pow(rim, 3.0) * 0.4;
  color += vec3(0.3, 0.4, 0.6) * rim;
  
  // Comic outline
  float edge = edgeDetect(normal, viewDir);
  color = mix(color, vec3(0.05, 0.05, 0.1), edge * 0.8);
  
  // Add subtle halftone in shadow areas
  float NdotL = dot(normal, lightDir);
  if (NdotL < 0.0) {
    float halftonePattern = halftone(vUv, 1.0 - NdotL);
    color = mix(color, color * 0.7, halftonePattern * 0.3);
  }
  
  // Boost saturation for comic look
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(gray), color, 1.3);
  
  gl_FragColor = vec4(color, 1.0);
}
