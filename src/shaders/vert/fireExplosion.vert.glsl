// Fire explosion billboard/volume vertex shader.
// Feeds a local-space position and view direction to the fragment shader.
varying vec3 vLocal;
varying vec3 vViewDir;

void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
