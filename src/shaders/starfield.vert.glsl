varying vec3 vDirection;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vDirection = worldPos.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
