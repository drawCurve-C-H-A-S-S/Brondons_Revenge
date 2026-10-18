import * as THREE from 'three';
import starfieldVert from '../../shaders/starfield.vert.glsl?raw';
import starfieldFrag from '../../shaders/starfield.frag.glsl?raw';

export interface StarfieldConfig {
  scene: THREE.Scene;
  nebulaOpacity?: number;
  starCount?: number;
  glowOpacity?: number;
  scale?: number;
  sizeScale?: number;
  dither?: boolean;
}

export interface Starfield {
  nebulaCubes: THREE.Mesh[];
  starLayers: THREE.Points[];
  update(time: number): void;
  dispose(): void;
}

export function createStarfield(config: StarfieldConfig): Starfield {
  const {
    scene,
    nebulaOpacity = 1.0,
    starCount = 650,
    glowOpacity = 0.15,
    scale = 1.0,
    sizeScale = 1.0,
    dither = true,
  } = config;

  // --- Nebula cubemaps ---
  const nebulaColors = [
    { color: new THREE.Vector3(0.35, 0.24, 0.42), offset: new THREE.Vector3(0, 0, 0), opacity: 0.15, octaves: 2, blendColor: new THREE.Vector3(0.48, 0.28, 0.18) },
    { color: new THREE.Vector3(0.55, 0.20, 0.25), offset: new THREE.Vector3(200, 150, 125), opacity: 0.2, octaves: 3, blendColor: new THREE.Vector3(0.65, 0.35, 0.15) },
    { color: new THREE.Vector3(0.58, 0.35, 0.50), offset: new THREE.Vector3(300, 250, 200), opacity: 0.2, octaves: 3, blendColor: new THREE.Vector3(0.45, 0.25, 0.45) },
    { color: new THREE.Vector3(0.0, 0.0, 0.0), offset: new THREE.Vector3(400, 350, 300), opacity: 0.3, invertAlpha: true, octaves: 4 },
  ];
  const nebulaCubes: THREE.Mesh[] = [];
  const cubeSizes = [700, 500, 440, 400].map(s => s * scale);

  for (let i = 0; i < nebulaColors.length; i++) {
    const { color, offset, opacity = 0.3, invertAlpha = false, octaves = 5, blendColor } = nebulaColors[i];
    const hasBlend = blendColor !== undefined;
    const uniforms = {
      uTime: { value: 0.0 },
      uColor: { value: color },
      uBlendColor: { value: blendColor || new THREE.Vector3(0, 0, 0) },
      uNoiseOffset: { value: offset },
      uOpacity: { value: opacity * nebulaOpacity },
      uInvertAlpha: { value: invertAlpha },
      uOctaves: { value: octaves },
      uHasBlend: { value: hasBlend },
      uDither: { value: dither },
      uRidgeStrength: { value: i < 2 ? 0.6 : 0.0 },
      uWarpStrength: { value: 0.5 },
      uThresholdLow: { value: i === 2 ? 0.35 : 0.45 },
      uThresholdHigh: { value: i === 2 ? 0.55 : 0.6 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: starfieldVert,
      fragmentShader: starfieldFrag,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
    });
    const size = cubeSizes[i];
    // Spheres avoid the visible seams a skybox cube produces at its face edges.
    const cube = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 32, 16), mat);
    cube.frustumCulled = false;
    cube.renderOrder = 0;
    scene.add(cube);
    nebulaCubes.push(cube);
  }

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
    const starColors = [
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
    update(time: number) {
      for (const cube of nebulaCubes) {
        (cube.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
        cube.rotation.y = time * 0.02;
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
      for (const layer of starLayers) {
        layer.geometry.dispose();
        (layer.material as THREE.ShaderMaterial).dispose();
      }
    },
  };
}
