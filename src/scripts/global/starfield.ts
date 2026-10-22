import * as THREE from 'three';
import starfieldVert from '../../shaders/vert/starfield.vert.glsl?raw';
import starfieldFrag from '../../shaders/frag/starfield.frag.glsl?raw';

export interface StarfieldConfig {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  nebulaOpacity?: number;
  starCount?: number;
  glowOpacity?: number;
  scale?: number;
  sizeScale?: number;
  dither?: boolean;
  nebulaScale?: number;
  starColors?: number[][];
  // Muted purple-blue -> red -> orange tint; when omitted the original palette is used.
  nebulaProgress?: number;
}

export interface Starfield {
  nebulaCubes: THREE.Mesh[];
  starLayers: THREE.Points[];
  setNebulaProgress(progress: number): void;
  update(time: number): void;
  dispose(): void;
}

export function createStarfield(config: StarfieldConfig): Starfield {
  const {
    scene,
    renderer,
    nebulaOpacity = 1.0,
    starCount = 650,
    glowOpacity = 0.15,
    scale = 1.0,
    sizeScale = 1.0,
    dither = false,
    nebulaScale = scale,
    starColors: customStarColors,
    nebulaProgress,
  } = config;

  const tintStops = [
    [new THREE.Color(0.10, 0.09, 0.26), new THREE.Color(0.20, 0.10, 0.30)],
    [new THREE.Color(0.26, 0.09, 0.13), new THREE.Color(0.30, 0.12, 0.12)],
    [new THREE.Color(0.30, 0.18, 0.09), new THREE.Color(0.24, 0.10, 0.10)],
  ];
  const tintA = new THREE.Vector3();
  const tintB = new THREE.Vector3();
  const tintColor = new THREE.Color();
  function setTint(progress: number) {
    const p = THREE.MathUtils.clamp(progress, 0, 1) * (tintStops.length - 1);
    const i = Math.min(tintStops.length - 2, Math.floor(p));
    const f = p - i;
    tintColor.copy(tintStops[i][0]).lerp(tintStops[i + 1][0], f);
    tintA.set(tintColor.r, tintColor.g, tintColor.b);
    tintColor.copy(tintStops[i][1]).lerp(tintStops[i + 1][1], f);
    tintB.set(tintColor.r, tintColor.g, tintColor.b);
  }
  const useTint = nebulaProgress !== undefined;
  setTint(nebulaProgress ?? 0);

  // --- Nebula cubemaps ---
  const nebulaColors = [
    { color: new THREE.Vector3(0.045, 0.055, 0.20), offset: new THREE.Vector3(0, 0, 0), opacity: 0.15, octaves: 2, blendColor: new THREE.Vector3(1.20, 0.60, 0.15) },
    { color: new THREE.Vector3(0.035, 0.08, 0.24), offset: new THREE.Vector3(200, 150, 125), opacity: 0.2, octaves: 3, blendColor: new THREE.Vector3(0.22, 0.09, 0.42) },
    { color: new THREE.Vector3(0.10, 0.07, 0.29), offset: new THREE.Vector3(300, 250, 200), opacity: 0.2, octaves: 3, blendColor: new THREE.Vector3(1.40, 0.70, 0.20) },
    { color: new THREE.Vector3(0.0, 0.0, 0.0), offset: new THREE.Vector3(400, 350, 300), opacity: 0.2, invertAlpha: true, octaves: 3 },
  ];
  const bakedTargets: THREE.WebGLRenderTarget[] = [];

  const texWidth = 2048, texHeight = 1024;
  const bakeRenderer = renderer || new THREE.WebGLRenderer({ alpha: true, antialias: false });
  if (!renderer) bakeRenderer.setSize(texWidth, texHeight);

  const bakeVertShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const bakeFragShader = `
    uniform vec3 uColor;
    uniform vec3 uBlendColor;
    uniform vec3 uNoiseOffset;
    uniform float uOpacity;
    uniform bool uInvertAlpha;
    uniform int uOctaves;
    uniform bool uHasBlend;
    uniform bool uDither;
    uniform float uRidgeStrength;
    uniform float uWarpStrength;
    uniform float uThresholdLow;
    uniform float uThresholdHigh;
    uniform vec3 uTint;
    uniform vec3 uTint2;
    uniform float uTintMix;
    varying vec2 vUv;

    // Copy of hash/noise/fbm/ridgeFbm from starfield.frag.glsl
    float hash(vec3 p) {
      p = fract(p * vec3(443.897, 441.423, 437.195));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      
      float a = hash(i);
      float b = hash(i + vec3(1.0, 0.0, 0.0));
      float c = hash(i + vec3(0.0, 1.0, 0.0));
      float d = hash(i + vec3(1.0, 1.0, 0.0));
      float e = hash(i + vec3(0.0, 0.0, 1.0));
      float ff = hash(i + vec3(1.0, 0.0, 1.0));
      float g = hash(i + vec3(0.0, 1.0, 1.0));
      float h = hash(i + vec3(1.0, 1.0, 1.0));
      
      float x1 = mix(a, b, f.x);
      float x2 = mix(c, d, f.x);
      float x3 = mix(e, ff, f.x);
      float x4 = mix(g, h, f.x);
      float y1 = mix(x1, x2, f.y);
      float y2 = mix(x3, x4, f.y);
      return mix(y1, y2, f.z);
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;
      for (int i = 0; i < 8; i++) {
        if (i >= uOctaves) break;
        value += amplitude * noise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }
      return value;
    }

    float ridgeNoise(vec3 p) {
      return 1.0 - abs(noise(p) * 2.0 - 1.0);
    }

    float ridgeFbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;
      for (int i = 0; i < 8; i++) {
        if (i >= uOctaves) break;
        value += amplitude * ridgeNoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }
      return value;
    }

    void main() {
      // Equirectangular UV to direction
      float phi = vUv.x * 2.0 * 3.14159265;
      float theta = (1.0 - vUv.y) * 3.14159265;
      vec3 dir = vec3(
        sin(theta) * cos(phi),
        cos(theta),
        sin(theta) * sin(phi)
      );

      vec3 pos = dir * 10.0 + uNoiseOffset;
      vec3 p1 = pos * 0.3;
      vec3 p2 = pos * 0.15 + 100.0;

      float warpX = fbm(p1 + vec3(13.1, 5.2, 1.7));
      float warpY = fbm(p1 + vec3(2.8, 17.3, 9.2));
      vec3 warped1 = p1 + (vec3(warpX - 0.5, warpY - 0.5, (warpX - warpY) * 0.5) * uWarpStrength * 2.0);
      float warp2 = fbm(p2 + vec3(8.0, 21.0, 3.0));
      vec3 warped2 = p2 + vec3(warp2 - 0.5, (warp2 - 0.5) * 0.4, 0.5 - warp2) * uWarpStrength;

      float nebula = mix(fbm(warped1), ridgeFbm(warped1), uRidgeStrength);
      float nebula2 = fbm(warped2);
      float cloud = nebula * 0.7 + nebula2 * 0.3;

      float density = smoothstep(uThresholdLow, uThresholdHigh, cloud);
      if (uInvertAlpha) {
        density = smoothstep(uThresholdHigh, uThresholdHigh + 0.08, cloud);
      }
      float cloudAlpha = density * uOpacity;

      float colorField = fbm(pos * 0.08 + vec3(31.0, 12.0, 54.0));
      float hue = smoothstep(0.22, 0.78, colorField);
      vec3 finalColor = uColor;
      if (uHasBlend) {
        finalColor = mix(uColor, uBlendColor, hue);
      }
      vec3 bluePurple = mix(vec3(0.035, 0.075, 0.24), vec3(0.24, 0.08, 0.43), hue);
      vec3 cloudColor = mix(finalColor, bluePurple, 0.45);
      vec3 softHighlight = mix(vec3(0.13, 0.25, 0.46), vec3(0.43, 0.25, 0.61), hue);
      cloudColor = mix(cloudColor, softHighlight, smoothstep(0.48, 0.92, density) * 0.45);
      cloudColor = mix(cloudColor, mix(uTint, uTint2, hue), uTintMix);
      vec3 voidColor = vec3(0.006, 0.012, 0.035);
      vec3 color = mix(voidColor, cloudColor, density);
      
      gl_FragColor = vec4(color, cloudAlpha);
    }
  `;

  for (let i = 0; i < nebulaColors.length; i++) {
    const { color, offset, opacity = 0.3, invertAlpha = false, octaves = 8, blendColor } = nebulaColors[i];
    const hasBlend = blendColor !== undefined;

    const bakeUniforms = {
      uColor: { value: color },
      uBlendColor: { value: blendColor || new THREE.Vector3(0, 0, 0) },
      uNoiseOffset: { value: offset },
      uOpacity: { value: opacity * nebulaOpacity },
      uInvertAlpha: { value: invertAlpha },
      uOctaves: { value: octaves },
      uHasBlend: { value: hasBlend },
      uDither: { value: false },
      uRidgeStrength: { value: i < 2 ? 0.08 : 0.0 },
      uWarpStrength: { value: 0.5 },
      uThresholdLow: { value: i < 2 ? 0.45 : (i === 2 ? 0.35 : 0.7) },
      uThresholdHigh: { value: i < 2 ? 0.6 : (i === 2 ? 0.55 : 0.78) },
      uTint: { value: new THREE.Vector3(0, 0, 0) },
      uTint2: { value: new THREE.Vector3(0, 0, 0) },
      uTintMix: { value: 0.0 },
    };

    const bakeMat = new THREE.ShaderMaterial({
      vertexShader: bakeVertShader,
      fragmentShader: bakeFragShader,
      uniforms: bakeUniforms,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      blending: THREE.NoBlending,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMat);
    const bakeScene = new THREE.Scene();
    bakeScene.add(quad);

    const renderTarget = new THREE.WebGLRenderTarget(texWidth, texHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    renderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

    const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const prevTarget = bakeRenderer.getRenderTarget();
    const prevToneMapping = bakeRenderer.toneMapping;
    bakeRenderer.toneMapping = THREE.NoToneMapping;
    bakeRenderer.setRenderTarget(renderTarget);
    bakeRenderer.setClearColor(0x000000, 0);
    bakeRenderer.clear();
    bakeRenderer.render(bakeScene, bakeCamera);
    bakeRenderer.setRenderTarget(prevTarget);
    bakeRenderer.toneMapping = prevToneMapping;

    bakedTargets.push(renderTarget);

    bakeMat.dispose();
    quad.geometry.dispose();
  }

  if (!renderer) bakeRenderer.dispose();

  // --- Nebula shell: one BackSide sphere composites all baked layers in-shader ---
  const shellVertShader = `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const shellFragShader = `
    uniform sampler2D tLayer0;
    uniform sampler2D tLayer1;
    uniform sampler2D tLayer2;
    uniform sampler2D tLayer3;
    uniform mat3 uRot0;
    uniform mat3 uRot1;
    uniform mat3 uRot2;
    uniform mat3 uRot3;
    varying vec3 vDir;

    vec4 sampleLayer(sampler2D tex, mat3 rot, vec3 dir) {
      vec3 d = rot * dir;
      float phi = atan(d.z, d.x);
      float theta = acos(clamp(d.y, -1.0, 1.0));
      vec2 uv = vec2(fract(phi * 0.15915494), 1.0 - theta * 0.31830989);
      return texture2D(tex, uv);
    }

    void main() {
      vec3 dir = normalize(vDir);
      vec3 accum = vec3(0.0);
      float transmittance = 1.0;
      vec4 s;
      s = sampleLayer(tLayer0, uRot0, dir); accum += s.rgb * s.a * transmittance; transmittance *= 1.0 - s.a;
      s = sampleLayer(tLayer1, uRot1, dir); accum += s.rgb * s.a * transmittance; transmittance *= 1.0 - s.a;
      s = sampleLayer(tLayer2, uRot2, dir); accum += s.rgb * s.a * transmittance; transmittance *= 1.0 - s.a;
      s = sampleLayer(tLayer3, uRot3, dir); accum += s.rgb * s.a * transmittance; transmittance *= 1.0 - s.a;
      float alpha = 1.0 - transmittance;
      gl_FragColor = vec4(alpha > 0.001 ? accum / alpha : vec3(0.0), alpha);
    }
  `;

  const shellUniforms: Record<string, THREE.IUniform> = {
    tLayer0: { value: bakedTargets[0].texture },
    tLayer1: { value: bakedTargets[1].texture },
    tLayer2: { value: bakedTargets[2].texture },
    tLayer3: { value: bakedTargets[3].texture },
    uRot0: { value: new THREE.Matrix3() },
    uRot1: { value: new THREE.Matrix3() },
    uRot2: { value: new THREE.Matrix3() },
    uRot3: { value: new THREE.Matrix3() },
  };
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: shellUniforms,
    vertexShader: shellVertShader,
    fragmentShader: shellFragShader,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(350 * nebulaScale, 32, 16), shellMaterial);
  shell.name = 'NebulaShell';
  shell.frustumCulled = false;
  shell.renderOrder = 0;
  scene.add(shell);
  // Scene15/16 copy shuttle positions onto these; kept as an array for compatibility.
  const nebulaCubes: THREE.Mesh[] = [shell];
  const layerEuler = new THREE.Euler();
  const layerMatrix = new THREE.Matrix4();

  // --- Stars ---
  const starVertShader = `
    precision mediump float;
    attribute float size;
    attribute float shape;
    attribute vec3 color;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uSizeScale;
    uniform float uRadius;
    varying vec3 vColor;
    varying float vShape;
    varying float vOpacity;
    void main() {
      vColor = color;
      vShape = shape;
      vOpacity = uOpacity;
      vec3 animated = position;
      float normDistSq = dot(position.xz, position.xz) / (uRadius * uRadius);
      float distFactor = 1.0 / (1.0 + normDistSq * 2.0);
      float angle = uTime * 0.02 * uSpeed * distFactor;
      float cosA = cos(angle);
      float sinA = sin(angle);
      vec3 rotated = vec3(
        animated.x * cosA - animated.z * sinA,
        animated.y,
        animated.x * sinA + animated.z * cosA
      );
      vec4 mvPosition = modelViewMatrix * vec4(rotated, 1.0);
      gl_PointSize = size * uSizeScale * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
  const starFragShader = `
    precision mediump float;
    varying vec3 vColor;
    varying float vShape;
    varying float vOpacity;
    void main() {
      vec2 center = gl_PointCoord - 0.5;
      float alpha = 1.0;
      int shape = int(vShape + 0.5);
      if (shape == 0) {
        float dist = length(center);
        if (dist > 0.5) alpha = 0.0;
      } else if (shape == 1) {
        if (abs(center.x) > 0.5 || abs(center.y) > 0.5) alpha = 0.0;
      } else if (shape == 2) {
        float dist = abs(center.x) + abs(center.y);
        if (dist > 0.5) alpha = 0.0;
      } else if (shape == 3) {
        float dist = length(center);
        float angle = atan(center.y, center.x);
        float star = abs(cos(angle * 2.0));
        if (dist > 0.5 * mix(0.3, 1.0, star)) alpha = 0.0;
      }
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(vColor, alpha * vOpacity);
    }
  `;

  const starLayers: THREE.Points[] = [];

  function makeStars(count: number, baseSize: number, brightness: number, renderOrder: number) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const shapes = new Float32Array(count);
    const halfSize = 170 * scale;
    const starColors = customStarColors ?? [
      [1.0, 1.0, 1.0],
      [1.0, 1.0, 1.0],
      [1.0, 1.0, 1.0],
      [1.0, 0.9, 0.4],
      [1.0, 0.6, 0.2],
      [1.0, 0.5, 0.4],
    ];
    for (let i = 0; i < count; i++) {
      const rx = Math.random() * 2 - 1;
      const ry = Math.random() * 2 - 1;
      const rz = Math.random() * 2 - 1;
      const x = Math.sign(rx) * Math.pow(Math.abs(rx), 0.75) * halfSize;
      const y = Math.sign(ry) * Math.pow(Math.abs(ry), 0.75) * halfSize;
      const z = Math.sign(rz) * Math.pow(Math.abs(rz), 0.75) * halfSize;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const colorIdx = Math.floor(Math.random() * starColors.length);
      const [r, g, b] = starColors[colorIdx];
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      sizes[i] = baseSize * (0.5 + Math.random());
      shapes[i] = Math.floor(Math.random() * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('shape', new THREE.BufferAttribute(shapes, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: starVertShader,
      fragmentShader: starFragShader,
      uniforms: {
        uOpacity: { value: brightness },
        uTime: { value: 0.0 },
        uSpeed: { value: renderOrder < 0 ? 2.0 : 1.0 },
        uSizeScale: { value: sizeScale },
        uRadius: { value: 170 * scale },
      },
      transparent: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(geometry, material);
    stars.name = 'Starfield';
    stars.renderOrder = renderOrder;
    stars.material.fog = false;
    scene.add(stars);
    starLayers.push(stars);

    const glowSizes = new Float32Array(count);
    const glowColors = new Float32Array(colors);
    for (let i = 0; i < count; i++) {
      glowSizes[i] = sizes[i] * 3.0;
    }
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
    glowGeometry.setAttribute('size', new THREE.BufferAttribute(glowSizes, 1));
    glowGeometry.setAttribute('shape', new THREE.BufferAttribute(shapes, 1));
    const glowMaterial = new THREE.ShaderMaterial({
      vertexShader: starVertShader,
      fragmentShader: starFragShader,
      uniforms: {
        uOpacity: { value: glowOpacity },
        uTime: { value: 0.0 },
        uSpeed: { value: renderOrder < 0 ? 2.0 : 1.0 },
        uSizeScale: { value: sizeScale },
        uRadius: { value: 170 * scale },
      },
      transparent: true,
      depthWrite: false,
    });
    const glow = new THREE.Points(glowGeometry, glowMaterial);
    glow.name = 'StarGlow';
    glow.renderOrder = renderOrder;
    glow.material.fog = false;
    scene.add(glow);
    starLayers.push(glow);
  }

  makeStars(starCount, 0.9, 0.6, -1);
  makeStars(Math.floor(starCount * 0.625), 1.8, 0.8, 2);

  return {
    nebulaCubes,
    starLayers,
    setNebulaProgress(progress: number) {
      setTint(progress);
    },
    update(time: number) {
      if (useTint) setTint(nebulaProgress! + 0.2 * Math.min(1, time / 240));
      for (let i = 0; i < 4; i++) {
        layerEuler.set(
          Math.sin(time * 0.006 + i * 1.3) * 0.02,
          time * (0.003 + i * 0.001) * (i % 2 === 0 ? 1 : -1),
          Math.cos(time * 0.005 + i * 0.9) * 0.015,
        );
        layerMatrix.makeRotationFromEuler(layerEuler);
        (shellUniforms[`uRot${i}`].value as THREE.Matrix3).setFromMatrix4(layerMatrix).transpose();
      }
      for (const layer of starLayers) {
        (layer.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      }
    },
    dispose() {
      for (const cube of nebulaCubes) {
        cube.geometry.dispose();
        (cube.material as THREE.ShaderMaterial).dispose();
      }
      for (const target of bakedTargets) target.dispose();
      for (const layer of starLayers) {
        layer.geometry.dispose();
        (layer.material as THREE.ShaderMaterial).dispose();
      }
    },
  };
}
