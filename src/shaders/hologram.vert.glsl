#include <common>
#include <skinning_pars_vertex>
varying vec3 hologramPosition;
varying vec3 hologramNormal;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  hologramPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  hologramNormal = normalize(mat3(modelMatrix) * objectNormal);
  #include <project_vertex>
}