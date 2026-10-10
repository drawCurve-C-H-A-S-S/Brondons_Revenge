import * as THREE from 'three';

function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix + iy * 157 + 113);
  const b = hash(ix + 1 + iy * 157 + 113);
  const c = hash(ix + (iy + 1) * 157 + 113);
  const d = hash(ix + 1 + (iy + 1) * 157 + 113);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  let v = 0, a = 0.5, f = 1.7;
  for (let i = 0; i < 6; i++) {
    v += a * noise2(x * f, y * f);
    a *= 0.5;
    f *= 2.1;
  }
  return v;
}

function warpedFbm(x: number, y: number): number {
  const wx = fbm(x + 1.7, y + 9.2) * 2 - 1;
  const wy = fbm(x + 8.3, y + 2.8) * 2 - 1;
  return fbm(x + 0.8 * wx, y + 0.8 * wy);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpRGB(a: number[], b: number[], t: number): [number, number, number] {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

const C = {
  deepOcean: [13, 50, 96],
  midOcean: [19, 72, 122],
  shallowOcean: [36, 108, 152],
  coastOcean: [56, 138, 172],
  beach: [188, 172, 118],
  desert: [198, 158, 96],
  savanna: [148, 138, 70],
  dryGrass: [128, 122, 62],
  tropicalForest: [32, 86, 42],
  temperateForest: [58, 100, 55],
  temperateGrass: [80, 120, 62],
  borealForest: [45, 78, 52],
  tundra: [108, 96, 78],
  mountain: [112, 102, 88],
  snowLow: [200, 210, 215],
  snowHigh: [228, 236, 242],
};

export interface EarthTextures {
  colorTexture: THREE.DataTexture;
  roughnessTexture: THREE.DataTexture;
  cloudTexture: THREE.DataTexture;
}

let cachedTextures: EarthTextures | undefined;
let preparation: Promise<void> | undefined;

export function createEarthTextures(width = 2048, height = 1024): EarthTextures {
  const generator = generateEarthTextures(width, height);
  let result = generator.next();
  while (!result.done) result = generator.next();
  return result.value;
}

export function preloadEarthTextures(): Promise<void> {
  if (cachedTextures) return Promise.resolve();
  if (!preparation) {
    preparation = (async () => {
      const generator = generateEarthTextures(2048, 1024);
      let result = generator.next();
      while (!result.done) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        result = generator.next();
      }
      Object.values(result.value).forEach(texture => texture.dispose());
    })().catch(error => { preparation = undefined; throw error; });
  }
  return preparation;
}

function* generateEarthTextures(width: number, height: number): Generator<void, EarthTextures> {
  const cacheable = width === 2048 && height === 1024;
  if (cacheable && cachedTextures) return {
    colorTexture: cachedTextures.colorTexture.clone(),
    roughnessTexture: cachedTextures.roughnessTexture.clone(),
    cloudTexture: cachedTextures.cloudTexture.clone(),
  };
  const size = width * height;
  const colorData = new Uint8Array(size * 4);
  const roughData = new Uint8Array(size * 4);
  const cloudData = new Uint8Array(size * 4);
  const SX = 3.71, SY = 1.38;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = px / width, v = py / height;
      const lat = (0.5 - v) * Math.PI;
      const absLat = Math.abs(lat) / (Math.PI * 0.5);
      const nx = (u + SX) * 2.6, ny = (v + SY) * 2.6;
      const rawH = warpedFbm(nx, ny), h = rawH * 2 - 1;
      const moist = fbm(nx * 0.6 + 10.5, ny * 0.6 + 4.3) * 2 - 1;
      const temp = 1 - absLat - Math.max(0, h) * 0.35;
      const i = (py * width + px) * 4;
      let r: number, g: number, b: number, roughness: number;

      if (h < -0.04) {
        const depth = smoothstep(-0.04, -1.0, h);
        let col: [number, number, number];
        if (depth < 0.25) {
          col = lerpRGB(C.coastOcean, C.shallowOcean, depth / 0.25);
        } else if (depth < 0.6) {
          col = lerpRGB(C.shallowOcean, C.midOcean, (depth - 0.25) / 0.35);
        } else {
          col = lerpRGB(C.midOcean, C.deepOcean, (depth - 0.6) / 0.4);
        }
        [r, g, b] = col;
        roughness = 0.06 + depth * 0.08;
      } else {
        roughness = 0.88;
        const isSnow = absLat > 0.87 || (h > 0.6 && absLat > 0.48);
        const isTundra = !isSnow && absLat > 0.72;
        const isMountain = !isSnow && h > 0.5;

        if (isSnow) {
          const t = smoothstep(0.82, 1.0, absLat) + smoothstep(0.55, 0.75, h) * 0.5;
          [r, g, b] = lerpRGB(C.snowLow, C.snowHigh, Math.min(1, t));
          roughness = 0.75;
        } else if (isTundra) {
          const n = noise2(nx * 9, ny * 9);
          [r, g, b] = lerpRGB(C.tundra, C.borealForest, n * 0.4);
        } else if (isMountain) {
          const n = noise2(nx * 11, ny * 11);
          [r, g, b] = lerpRGB(C.mountain, [130, 118, 100], n);
          roughness = 0.92;
        } else if (temp < 0.18) {
          const n = noise2(nx * 7, ny * 7);
          [r, g, b] = lerpRGB(C.borealForest, [50, 84, 56], n);
        } else if (temp > 0.65 && moist < -0.08) {
          if (moist < -0.45) {
            [r, g, b] = lerpRGB(C.savanna, C.desert, (-moist - 0.45) / 0.55);
          } else {
            [r, g, b] = lerpRGB(C.dryGrass, C.savanna, (-moist - 0.08) / 0.37);
          }
        } else if (moist > 0.18 && temp > 0.52) {
          const n = noise2(nx * 14, ny * 14);
          [r, g, b] = lerpRGB(C.tropicalForest, [28, 78, 38], n * 0.5);
        } else if (temp > 0.38) {
          const blend = smoothstep(-0.2, 0.5, moist);
          [r, g, b] = lerpRGB(C.temperateGrass, C.temperateForest, blend);
        } else {
          const blend = smoothstep(-0.3, 0.3, moist);
          [r, g, b] = lerpRGB([68, 105, 60], C.borealForest, blend * 0.5);
        }

        if (h < 0.07) {
          const beachBlend = 1 - h / 0.07;
          [r, g, b] = lerpRGB([r, g, b], C.beach, beachBlend * 0.55);
        }
      }

      colorData.set([r, g, b, 255], i);
      const rv = Math.round(roughness * 255);
      roughData.set([rv, rv, rv, 255], i);
    }
    if (py % 4 === 3) yield;
  }

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = px / width, v = py / height;
      const absLat = Math.abs(0.5 - v) * 2;
      const cx = u * 5.5 + 22, cy = v * 2.8 + 18;
      const cloud = fbm(cx, cy);
      const latBias = 0.5 + 0.5 * Math.cos((absLat - 0.18) * Math.PI);
      const rawAlpha = (cloud * 1.8 - 0.6) * latBias;
      const alpha = Math.max(0, Math.min(255, Math.round(rawAlpha * 255)));
      const i = (py * width + px) * 4;
      cloudData.set([242, 248, 252, alpha], i);
    }
    if (py % 8 === 7) yield;
  }

  const colorTexture = new THREE.DataTexture(colorData, width, height);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.needsUpdate = true;
  const roughnessTexture = new THREE.DataTexture(roughData, width, height);
  roughnessTexture.needsUpdate = true;
  const cloudTexture = new THREE.DataTexture(cloudData, width, height);
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  cloudTexture.needsUpdate = true;
  // Reuse generated pixels, but keep texture ownership separate across scene disposal.
  if (cacheable) cachedTextures = {
    colorTexture: colorTexture.clone(),
    roughnessTexture: roughnessTexture.clone(),
    cloudTexture: cloudTexture.clone(),
  };
  return { colorTexture, roughnessTexture, cloudTexture };
}

export function createAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
        float glow = pow(rim, 3.0);
        vec3 col = mix(vec3(0.38, 0.78, 1.0), vec3(0.10, 0.42, 0.88), rim);
        float alpha = glow * 1.45 * uOpacity;
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

export function createEarthGroup(
  scene: THREE.Object3D,
  position: THREE.Vector3,
  radius: number,
  textures: EarthTextures,
) {
  const group = new THREE.Group();
  group.position.copy(position);
  scene.add(group);
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 80, 60),
    new THREE.MeshStandardMaterial({
      map: textures.colorTexture, roughnessMap: textures.roughnessTexture, roughness: 1, metalness: 0,
    }),
  );
  surface.name = 'EarthSurface';
  group.add(surface);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.006, 64, 48),
    new THREE.MeshStandardMaterial({
      map: textures.cloudTexture, transparent: true, depthWrite: false, roughness: 1, metalness: 0, opacity: 0.95,
    }),
  );
  clouds.name = 'EarthClouds';
  group.add(clouds);
  const haze = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.018, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x4da8e8, transparent: true, opacity: 0.09, side: THREE.BackSide, depthWrite: false,
    }),
  );
  haze.name = 'EarthHaze';
  group.add(haze);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.08, 64, 48), createAtmosphereMaterial(),
  );
  atmosphere.name = 'EarthAtmosphere';
  group.add(atmosphere);
  return Object.assign(group, { surface, clouds, haze, atmosphere });
}

export function updateEarthGroup(group: THREE.Group, dt: number): void {
  const surface = group.getObjectByName('EarthSurface');
  const clouds = group.getObjectByName('EarthClouds');
  if (surface) surface.rotation.y += dt * 0.018;
  if (clouds) clouds.rotation.y += dt * 0.022;
}
