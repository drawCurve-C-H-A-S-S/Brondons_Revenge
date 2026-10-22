varying vec2 flowUv;
void main() {
  flowUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
