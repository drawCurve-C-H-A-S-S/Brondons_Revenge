vec3 brondonNormal = inverseTransformDirection(normal, viewMatrix);
float brondonLight = dot(brondonNormal, normalize(vec3(0.5, 1.0, 0.5)));
float brondonShade = uBrondonUnshaded > 0.5 || brondonLight > -0.1 ? 1.0 : 0.5;
outgoingLight = uBrondonColor * (uCellShadingEnabled < 0.5 ? 0.3 : brondonShade);
