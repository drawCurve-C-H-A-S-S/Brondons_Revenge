#include <project_vertex>
#if !defined(USE_ENVMAP) && !defined(USE_SKINNING)
  vec3 transformedNormal = -normalMatrix * normal;
#endif
vec2 inkNormal = (projectionMatrix * vec4(-transformedNormal, 0.0)).xy;
gl_Position.xy += inkNormal / max(length(inkNormal), 0.001)
  * (4.0 / max(uInkViewport, vec2(1.0))) * gl_Position.w;
