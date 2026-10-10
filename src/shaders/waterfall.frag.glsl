uniform float uTime;
uniform float uMode;
uniform vec3 uOrigin;
uniform vec3 uWaterColor;
uniform vec3 uFoamColor;
uniform vec3 uSkyColor;
uniform vec3 uForestColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;

varying vec3 vWaterPosition;
varying vec3 vWaterNormal;
varying vec2 vFlowCoord;
varying vec2 vWaterUv;
varying float vSprayFade;

#include <common>
#include <fog_pars_fragment>
#include <jungle_water_noise>

void main() {
  vec3 color;
  float alpha;
  #ifdef WATERFALL_SPRAY
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    alpha = (1.0 - smoothstep(0.18, 1.0, radius)) * vSprayFade * 0.48;
    color = uFoamColor;
  #else
    if (uMode > 0.5) {
      vec2 pool = vWaterPosition.xz - uOrigin.xz;
      vec2 flow = pool * vec2(1.4, 0.65) - vec2(uTime * 1.5, 0.0);
      float turbulence = riverFbm(flow * 2.4);
      float spread = smoothstep(0.0, 0.8, vWaterUv.x) * (1.0 - smoothstep(0.8, 1.0, vWaterUv.x));
      float edge = smoothstep(0.0, 0.07, vWaterUv.y) * (1.0 - smoothstep(0.93, 1.0, vWaterUv.y));
      float ripple = sin(length(pool * vec2(1.0, 0.16)) * 11.0 - uTime * 6.0 + turbulence * 6.0);
      float foam = smoothstep(0.3, 0.68, turbulence) + smoothstep(0.75, 1.0, ripple) * 0.22;
      alpha = clamp(foam, 0.0, 0.85) * spread * edge;
      color = mix(uWaterColor, uFoamColor, foam);
    } else {
      vec2 flow = vFlowCoord;
      float broad = riverFbm(flow * vec2(0.65, 0.85));
      vec3 detailA = riverNoise(flow * vec2(5.3, 1.7));
      vec3 detailB = riverNoise(flow * vec2(13.2, 4.0) + vec2(7.1, uTime * 0.25));
      float footprint = max(length(dFdx(flow)), length(dFdy(flow)));
      float detail = 1.0 - smoothstep(0.12, 0.85, footprint);
      vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), vWaterNormal));
      vec3 normal = normalize(vWaterNormal - tangent * (detailA.y * 0.17 + detailB.y * 0.045 * detail)
        + vec3(0.0, detailA.z * 0.065, 0.0));
      if (!gl_FrontFacing) normal = -normal;
      vec3 viewDirection = normalize(cameraPosition - vWaterPosition);
      float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
      float fresnel = 0.025 + 0.975 * pow(1.0 - facing, 5.0);
      vec3 reflected = reflect(-viewDirection, normal);
      float sky = smoothstep(-0.1, 0.55, reflected.y);
      vec3 reflection = mix(uForestColor, uSkyColor, sky);
      float thickness = 0.1 + broad * 0.45;
      vec3 transmission = exp(-vec3(1.8, 0.45, 0.24) * thickness);
      vec3 scattering = uWaterColor * (0.5 + max(dot(normal, uSunDirection), 0.0) * 0.5);
      color = scattering * (vec3(1.0) - transmission) + reflection * (fresnel * 0.7 + 0.1);
      float veins = smoothstep(0.56, 0.79, broad + detailA.x * 0.18);
      float impact = 1.0 - smoothstep(0.0, 0.085, vWaterUv.y);
      float foam = clamp(veins * 0.38 + impact * (0.45 + detailA.x * 0.5), 0.0, 0.9);
      color = mix(color, uFoamColor, foam);
      vec3 halfDirection = normalize(viewDirection + uSunDirection);
      float sparkle = pow(max(dot(normal, halfDirection), 0.0), 92.0);
      color += uSunColor * sparkle * (0.15 + fresnel * 0.8) * detail;
      float feather = smoothstep(0.0, 0.045, vWaterUv.x) * (1.0 - smoothstep(0.955, 1.0, vWaterUv.x));
      alpha = clamp(0.2 + (1.0 - transmission.g) * 0.5 + fresnel * 0.4 + foam * 0.45, 0.18, 0.86) * feather;
    }
  #endif
  gl_FragColor = vec4(max(color, vec3(0.0)), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
