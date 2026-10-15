// Rust material vertex shader
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
  vViewPosition = -vPosition;

  gl_Position = projectionMatrix * viewMatrix * world;
}
