vec3 comicNormal = inverseTransformDirection(normal, viewMatrix);
float comicLight = dot(comicNormal, normalize(vec3(0.5, 1.0, 0.5)));
vec3 comicShade = comicLight > -0.1 ? vec3(1.0) : vec3(0.32, 0.36, 0.52);
if (uComicEnabled > 0.5) {
  vec3 comicLit = outgoingLight;
  vec3 comicBase = diffuseColor.rgb * comicShade + totalEmissiveRadiance;
  outgoingLight = mix(comicLit, comicBase, 0.3);
  outgoingLight *= mix(vec3(0.74, 0.79, 0.9), vec3(1.06), step(-0.1, comicLight));
}
