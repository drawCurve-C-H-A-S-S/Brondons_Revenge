import * as THREE from "three";
import { disposeRoom } from "../global/shipRoom.js";
import { createStarfield } from "../global/starfield.js";
import {
  createArmorTextures,
  createEnergyMaterial,
} from "./finaleMaterials.js";
import {
  PLANET_RUPTURE,
  samplePlanetBreaker,
  samplePlanetSurface,
} from "../global/finaleChoreography.js";
import {
  createEarthTextures,
  createEarthGroup,
} from "../global/earthTexture.js";
import {
  createFacilityCoreCutaway,
  createPlanetBreakerCore,
} from "./facilityCore.js";
import {
  FACILITY,
  FACILITY_ROOF_SEQUENCE,
} from "../global/facilityArchitecture.js";

export const PLANET_RADIUS = 340;
export const SPACE_ALTITUDE = 95;
export const FINALE_ROOFTOP = Object.freeze({
  x: FACILITY.x,
  y: FACILITY.roofY,
  z: FACILITY.z,
  width: FACILITY.width,
  depth: FACILITY.depth,
});
export const FINALE_DECK_Y = FINALE_ROOFTOP.y;
export const PLANET_CENTER = new THREE.Vector3(0, -PLANET_RADIUS - 2, 0);
export function finaleBattlePoint(x: number, y = 0, altitude = 0) {
  return new THREE.Vector3(
    FINALE_ROOFTOP.x + x * 0.9701425,
    FINALE_DECK_Y + y + altitude,
    FINALE_ROOFTOP.z - x * 0.2425356,
  );
}
export const FINALE_BATTLE_YAW = Math.atan2(0.9701425, -0.2425356);
const smooth = THREE.MathUtils.smootherstep;
const clamp = THREE.MathUtils.clamp;
function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function createFinaleWorld(
  scene: THREE.Scene,
  {
    facilityRoof,
    renderer,
  }: { facilityRoof?: THREE.Mesh; renderer?: THREE.WebGLRenderer } = {},
) {
  const root = new THREE.Group();
  root.name = "RescueSiteSummitAndOrbit";
  scene.add(root);
  const roofFog =
    scene.fog instanceof THREE.Fog
      ? scene.fog
      : new THREE.Fog(0x273138, 55, 230);
  const roofFogNear = roofFog.near,
    roofFogFar = roofFog.far;
  roofFog.color.set(0x273138);
  const roofBackground =
    scene.background instanceof THREE.Color
      ? scene.background
      : new THREE.Color(0x698475);
  scene.background = roofBackground;
  const spaceBackground = new THREE.Color(0x030711);
  const nightBackground = new THREE.Color(0x091121);
  const rooftopDestructionColor = new THREE.Color(0x2c3444);
  const forestFog = new THREE.Fog(0x231914, 14, 45);
  const armorTextures = createArmorTextures();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x697783,
    metalness: 0.9,
    roughness: 0.48,
    map: armorTextures.map,
    normalMap: armorTextures.normalMap,
    normalScale: new THREE.Vector2(0.26, 0.26),
    roughnessMap: armorTextures.roughnessMap,
  });
  const black = new THREE.MeshPhysicalMaterial({
    color: 0x121923,
    metalness: 0.86,
    roughness: 0.42,
    clearcoat: 0.7,
  });
  const floor =
    facilityRoof ??
    new THREE.Mesh(
      new THREE.BoxGeometry(
        FINALE_ROOFTOP.width,
        0.4,
        FINALE_ROOFTOP.depth - 1,
      ),
      metal,
    );
  if (!facilityRoof) {
    floor.name = "FacilityTopFloor";
    floor.position.set(FINALE_ROOFTOP.x, FINALE_DECK_Y - 0.2, FINALE_ROOFTOP.z);
    floor.castShadow = floor.receiveShadow = true;
    root.add(floor);
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1900, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 }, uNight: { value: 0 } },
      vertexShader: `varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uFade; uniform float uNight; varying vec3 vDirection; void main() {
      float elevation = normalize(vDirection).y;
      float gradient = smoothstep(-0.15, 0.88, elevation);
      vec3 dusk = mix(vec3(0.16, 0.14, 0.13), vec3(0.055, 0.08, 0.11), gradient);
      vec3 night = mix(vec3(0.055, 0.075, 0.115), vec3(0.009, 0.018, 0.042), gradient);
      vec3 color = mix(dusk, night, uNight);
      gl_FragColor = vec4(color, uFade); }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  sky.renderOrder = -100;
  sky.name = "FinaleNormalSky";
  root.add(sky);

  const planetRoot = createEarthGroup(
    root,
    PLANET_CENTER,
    PLANET_RADIUS,
    createEarthTextures(),
  );
  planetRoot.name = "Earth";
  planetRoot.visible = false;
  const planetRestRotation = planetRoot.quaternion.clone();
  const planetTremor = new THREE.Quaternion();
  const planetTremorAngles = new THREE.Euler();
  const planet = planetRoot.surface,
    planetMaterial = planet.material;
  const planetUniforms = {
    uRupture: { value: 0 },
    uTime: { value: 0 },
    uCrustDissolve: { value: 0 },
  };
  planetMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, planetUniforms);
    shader.vertexShader =
      "varying vec2 vPlanetUv; varying vec3 vPlanetP;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPlanetUv = uv; vPlanetP = normalize(position);",
      );
    shader.fragmentShader =
      `varying vec2 vPlanetUv; varying vec3 vPlanetP;
      uniform float uRupture; uniform float uTime; uniform float uCrustDissolve;
      float crustHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float crustNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(crustHash(i), crustHash(i + vec3(1,0,0)), f.x),
          mix(crustHash(i + vec3(0,1,0)), crustHash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(crustHash(i + vec3(0,0,1)), crustHash(i + vec3(1,0,1)), f.x),
          mix(crustHash(i + vec3(0,1,1)), crustHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
      float crust = crustNoise(vPlanetP * 22.0) * 0.7 + crustNoise(vPlanetP * 57.0) * 0.3;
      if (uCrustDissolve > 0.0 && crust < uCrustDissolve) discard;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      vec2 grid = abs(fract(vPlanetUv * vec2(35.0, 19.0) + sin(vPlanetUv.yx * 29.0) * 0.32) - 0.5);
      float crack = smoothstep(0.455, 0.49, max(grid.x, grid.y));
      float meltingEdge = (1.0 - smoothstep(0.0, 0.07, crust - uCrustDissolve)) * step(0.001, uCrustDissolve);
      totalEmissiveRadiance += vec3(1.0, 0.17, 0.025) * (crack * uRupture + meltingEdge) * (2.0 + sin(uTime * 8.0) * 0.25);`,
    );
  };
  planetMaterial.customProgramCacheKey = () => "finale-earth-melting-crust-v4";
  const fireMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRupture: { value: 0 },
      uDispersal: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vUv = uv;
        vNormal = normalize(normalMatrix * normal); vView = -p.xyz; gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform float uTime; uniform float uRupture; uniform float uDispersal;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        vec2 flow = vec2(vUv.x * 22.0, vUv.y * 12.0 - uTime * 0.2);
        float turbulence = noise(flow) * 0.62 + noise(flow * 2.1 + vec2(0.0, -uTime * 0.25)) * 0.38;
        if (uDispersal > 0.0 && turbulence < uDispersal) discard;
        float filaments = smoothstep(0.2, 0.88, turbulence + 0.18 * sin(vUv.y * 44.0 - uTime * 1.7));
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        vec3 color = mix(vec3(0.48, 0.025, 0.008), vec3(1.65, 0.3, 0.025), filaments);
        color = mix(color, vec3(2.4, 1.05, 0.24), smoothstep(0.7, 1.0, filaments + rim * 0.25));
        gl_FragColor = vec4(color * (0.8 + uRupture * 0.4), 1.0); }`,
    depthWrite: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  const fire = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS * 0.996, 56, 36),
    fireMaterial,
  );
  fire.name = "EarthBurningSurface";
  fire.visible = false;
  planetRoot.add(fire);
  const shockwaves = Array.from({ length: 3 }, (_, index) => {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? 0xfff2c1 : 0xff7132,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.018 + index * 0.009, 8, 128),
      material,
    );
    mesh.rotation.set(Math.PI / 2 + index * 0.34, index * 0.55, index * 0.18);
    mesh.visible = false;
    planetRoot.add(mesh);
    return mesh;
  });
  const blastLight = new THREE.PointLight(0xff8d43, 0, 1800, 0.7);
  blastLight.position.set(0, PLANET_RADIUS * 0.7, 0);
  planetRoot.add(blastLight);

  const starfieldRoot = new THREE.Group();
  starfieldRoot.name = "FinaleSpaceSky";
  root.add(starfieldRoot);
  const starfield = createStarfield({
    scene: starfieldRoot,
    renderer,
    starCount: 480,
    glowOpacity: 0.08,
    scale: 12,
    sizeScale: 12,
  });
  const point = new THREE.Vector3(),
    color = new THREE.Color();
  for (const layer of starfield.starLayers) {
    const positions = layer.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).normalize().multiplyScalar(3000);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
  }
  for (const layer of [...starfield.nebulaCubes, ...starfield.starLayers]) {
    layer.renderOrder -= 200;
    layer.frustumCulled = false;
    layer.onBeforeRender = (_renderer, _scene, viewCamera) => {
      viewCamera.getWorldPosition(layer.position);
      layer.parent?.worldToLocal(layer.position);
      layer.updateMatrixWorld(true);
    };
  }
  starfield.setOpacity(0);

  const dustCount = 1600,
    dustPositions = new Float32Array(dustCount * 3),
    dustSeeds = new Float32Array(dustCount),
    dustGeometry = new THREE.BufferGeometry();
  for (let i = 0; i < dustCount; i++) {
    const angle = i * 2.399963,
      cosine = 1 - (2 * (i + 0.5)) / dustCount,
      sine = Math.sqrt(1 - cosine * cosine);
    point
      .set(Math.cos(angle) * sine, cosine, Math.sin(angle) * sine)
      .multiplyScalar(PLANET_RADIUS * (0.94 + random(i + 71) * 0.06))
      .toArray(dustPositions, i * 3);
    dustSeeds[i] = random(i + 83);
  }
  dustGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(dustPositions, 3),
  );
  dustGeometry.setAttribute("aSeed", new THREE.BufferAttribute(dustSeeds, 1));
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAge: { value: -1 },
      uDuration: { value: PLANET_RUPTURE.stardustEnd - PLANET_RUPTURE.burst },
    },
    vertexShader: `uniform float uAge; uniform float uDuration; attribute float aSeed;
      varying float vSeed;
      void main() {
        float age = max(0.0, uAge);
        vec3 direction = normalize(position);
        vec3 drift = vec3(sin(aSeed * 37.0 + age * 0.8), cos(aSeed * 29.0 + age * 0.6), sin(aSeed * 43.0)) * age * 12.0;
        vec3 expanding = position + direction * age * (120.0 + aSeed * 220.0) + drift;
        vec4 p = modelViewMatrix * vec4(expanding, 1.0);
        gl_Position = projectionMatrix * p;
        gl_PointSize = clamp((4.0 + aSeed * 6.0) * (650.0 / max(1.0, -p.z)) * (1.0 - age / uDuration * 0.45), 1.0, 8.0);
        vSeed = aSeed;
      }`,
    fragmentShader: `uniform float uAge; uniform float uDuration; varying float vSeed;
      void main() {
        float glow = 1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5));
        float fade = 1.0 - smoothstep(0.3, uDuration, uAge);
        float alpha = glow * fade;
        if (alpha < 0.01) discard;
        vec3 color = mix(vec3(2.4, 0.55, 0.06), vec3(0.55, 0.82, 1.3), smoothstep(0.15, 2.8, uAge));
        gl_FragColor = vec4(color * (0.7 + vSeed * 0.5), alpha);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.name = "EarthStardust";
  dust.visible = false;
  dust.frustumCulled = false;
  dust.renderOrder = 10;
  planetRoot.add(dust);

  const debrisGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rockVertices = debrisGeometry.getAttribute("position");
  for (let i = 0; i < rockVertices.count; i++) {
    point.fromBufferAttribute(rockVertices, i);
    const erosion =
      0.82 +
      0.19 * Math.sin(point.x * 9.1 + point.z * 5.7) +
      0.14 * Math.cos(point.y * 11.3 - point.x * 3.4);
    rockVertices.setXYZ(
      i,
      point.x * erosion,
      point.y * erosion,
      point.z * erosion,
    );
  }
  debrisGeometry.computeVertexNormals();
  const rockBytes = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const grain = random(y * 128 + x),
        strata = Math.sin(x * 0.13 + Math.sin(y * 0.08) * 3);
      const tone = Math.round(87 + grain * 42 + strata * 15);
      rockBytes.set(
        [tone, Math.round(tone * 0.94), Math.round(tone * 0.88), 255],
        (y * 128 + x) * 4,
      );
    }
  const rockMap = new THREE.DataTexture(rockBytes, 128, 128, THREE.RGBAFormat);
  rockMap.colorSpace = THREE.SRGBColorSpace;
  rockMap.wrapS = rockMap.wrapT = THREE.RepeatWrapping;
  rockMap.needsUpdate = true;
  const debrisMaterial = new THREE.MeshStandardMaterial({
    color: 0xb1a698,
    map: rockMap,
    metalness: 0.02,
    roughness: 0.98,
    flatShading: true,
    transparent: true,
    depthWrite: false,
  });
  const debris = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, 48);
  debris.name = "EarthRockDebris";
  debris.visible = false;
  debris.frustumCulled = false;
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(debris);
  const dummy = new THREE.Object3D();
  const debrisFragments = Array.from({ length: debris.count }, (_, i) => {
    const angle = i * 2.399963,
      cosine = 1 - (2 * (i + 0.5)) / debris.count,
      sine = Math.sqrt(1 - cosine * cosine);
    debris.setColorAt(
      i,
      color.setHSL(
        0.08 + random(i + 30) * 0.04,
        0.08,
        0.5 + random(i + 31) * 0.35,
      ),
    );
    return {
      direction: new THREE.Vector3(
        Math.cos(angle) * sine,
        cosine,
        Math.sin(angle) * sine,
      ),
      speed: 150 + random(i + 9) * 140,
      size: 1.3 + random(i + 17) * 5.8,
    };
  });
  if (debris.instanceColor) debris.instanceColor.needsUpdate = true;

  const breaker = createPlanetBreakerCore(),
    bomb = breaker.root;
  bomb.name = "Sudoers5PlanetBreaker";
  bomb.visible = false;
  const facilityInterior = createFacilityCoreCutaway(scene);
  root.add(facilityInterior.root);
  root.add(bomb);
  const bombTrail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.55, 1, 12, 1, true),
    createEnergyMaterial(0xff8c39),
  );
  bombTrail.visible = false;
  root.add(bombTrail);
  const meteorStreaks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1, 4),
    new THREE.MeshBasicMaterial({
      color: 0xe3d9d0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
    }),
    12,
  );
  meteorStreaks.visible = false;
  meteorStreaks.frustumCulled = false;
  root.add(meteorStreaks);
  let releasePosition: THREE.Vector3 | null = null;
  const impactPosition = PLANET_CENTER.clone().add(
    new THREE.Vector3(0, PLANET_RADIUS, 0),
  );
  const bombDirection = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);

  return {
    root,
    floor,
    planet,
    planetRoot,
    bomb,
    facilityInterior,
    updateBomb(phaseTime: number, hands: THREE.Vector3) {
      const materialized = smooth(
        phaseTime,
        PLANET_RUPTURE.materialize,
        PLANET_RUPTURE.release - 0.3,
      );
      breaker.update(Math.max(0, phaseTime), materialized, materialized);
      bomb.visible =
        phaseTime >= PLANET_RUPTURE.materialize &&
        phaseTime < PLANET_RUPTURE.impact;
      facilityInterior.update(
        Math.max(0, phaseTime),
        1 -
          smooth(
            phaseTime,
            PLANET_RUPTURE.coreTransfer,
            PLANET_RUPTURE.coreGone,
          ),
        phaseTime >= PLANET_RUPTURE.facilityCut &&
          phaseTime < PLANET_RUPTURE.materialize,
      );
      bombTrail.visible = meteorStreaks.visible = false;
      if (phaseTime < 0) {
        releasePosition = null;
        return;
      }
      if (phaseTime < PLANET_RUPTURE.release) {
        bomb.position.copy(hands).add(new THREE.Vector3(0, 3.8, 0));
      } else {
        if (!releasePosition) {
          releasePosition = hands.clone().add(new THREE.Vector3(0, 3.8, 0));
          impactPosition
            .copy(releasePosition)
            .sub(PLANET_CENTER)
            .normalize()
            .multiplyScalar(PLANET_RADIUS)
            .add(PLANET_CENTER);
        }
        const origin: [number, number, number] = [
          releasePosition.x,
          releasePosition.y,
          releasePosition.z,
        ];
        const impact: [number, number, number] = [
          impactPosition.x,
          impactPosition.y,
          impactPosition.z,
        ];
        bomb.position.fromArray(samplePlanetBreaker(phaseTime, origin, impact));
        const previous = new THREE.Vector3().fromArray(
          samplePlanetBreaker(phaseTime - 0.07, origin, impact),
        );
        bombDirection.copy(bomb.position).sub(previous);
        const length = Math.min(100, bombDirection.length() * 8);
        bombTrail.visible = bomb.visible && length > 0.1;
        bombDirection.normalize();
        bombTrail.position
          .copy(bomb.position)
          .addScaledVector(bombDirection, -length * 0.5);
        bombTrail.scale.set(2.2, Math.max(0.001, length), 2.2);
        if (bombDirection.lengthSq() > 0)
          bombTrail.quaternion.setFromUnitVectors(up, bombDirection);
        bombTrail.material.uniforms.uTime.value = phaseTime;
        meteorStreaks.visible =
          bomb.visible && phaseTime > PLANET_RUPTURE.slam + 0.2;
        if (meteorStreaks.visible) {
          for (let i = 0; i < meteorStreaks.count; i++) {
            const angle = i * 2.399,
              radius = 8 + random(i) * 15;
            dummy.position
              .copy(bomb.position)
              .add(
                new THREE.Vector3(
                  Math.cos(angle) * radius,
                  0,
                  Math.sin(angle) * radius,
                ),
              )
              .addScaledVector(bombDirection, -10 - random(i + 1) * 50);
            dummy.quaternion.setFromUnitVectors(up, bombDirection);
            dummy.scale.set(1, 14 + random(i + 2) * 40, 1);
            dummy.updateMatrix();
            meteorStreaks.setMatrixAt(i, dummy.matrix);
          }
          meteorStreaks.instanceMatrix.needsUpdate = true;
        }
      }
      bomb.scale.setScalar(
        1.1 +
          smooth(phaseTime, PLANET_RUPTURE.release, PLANET_RUPTURE.apex) * 2.8,
      );
    },
    getBombPosition: () => bomb.position.clone(),
    getPlanetImpact: () => impactPosition.clone(),
    update(
      time: number,
      rupture: number,
      space: boolean,
      _reveal = 0,
      roofBlast = -1,
      ruptureTime = -1,
      night = 0,
      reducedMotion = false,
    ) {
      const planetView = ruptureTime >= PLANET_RUPTURE.wide;
      const forestView =
        ruptureTime >= PLANET_RUPTURE.forest &&
        ruptureTime < PLANET_RUPTURE.forestEnd;
      const cockpitView =
        ruptureTime >= PLANET_RUPTURE.cockpit &&
        ruptureTime < PLANET_RUPTURE.returnToDuel;
      planetRoot.visible =
        !space &&
        planetView &&
        !forestView &&
        !cockpitView &&
        ruptureTime < PLANET_RUPTURE.stardustEnd;
      floor.visible = !space && !planetView;
      sky.visible = !space && !planetView && rupture < 1;
      // Keep the fog shader variant resident; orbital distances make its contribution zero.
      roofFog.near = space || planetView ? 1e6 : roofFogNear;
      roofFog.far = space || planetView ? 1e6 + 1 : roofFogFar;
      scene.fog = forestView ? forestFog : roofFog;
      if (forestView) {
        roofBackground.copy(forestFog.color);
      } else if (space || planetView) {
        roofBackground.copy(spaceBackground);
      } else {
        roofBackground
          .set(0x263138)
          .lerp(nightBackground, night)
          .lerp(rooftopDestructionColor, smooth(rupture, 0, 1));
      }
      roofFog.color.copy(roofBackground);
      sky.material.uniforms.uFade.value =
        (1 - night * 0.8) * (1 - smooth(rupture, 0.15, 0.65));
      sky.material.uniforms.uNight.value = night;
      const surface = samplePlanetSurface(
        space ? PLANET_RUPTURE.stardustEnd : ruptureTime,
      );
      starfield.setOpacity(
        forestView
          ? 0
          : space
            ? 1
            : Math.max(
                night * 0.5,
                smooth(
                  ruptureTime,
                  PLANET_RUPTURE.escape,
                  PLANET_RUPTURE.wide + 1,
                ) * 0.8,
                surface.dispersal,
              ),
      );
      starfield.update(time);
      const rumble = reducedMotion ? 0 : surface.rumble;
      const tremor = rumble * (2 + rumble * 6);
      planetRoot.position
        .copy(PLANET_CENTER)
        .add(
          new THREE.Vector3(
            Math.sin(ruptureTime * 31) * tremor,
            Math.sin(ruptureTime * 43 + 0.7) * tremor * 0.55,
            Math.cos(ruptureTime * 37) * tremor * 0.35,
          ),
        );
      planetTremorAngles.set(
        Math.sin(ruptureTime * 23) * rumble * 0.009,
        0,
        Math.cos(ruptureTime * 29) * rumble * 0.012,
      );
      planetRoot.quaternion
        .copy(planetRestRotation)
        .multiply(planetTremor.setFromEuler(planetTremorAngles));
      planetUniforms.uRupture.value = Math.max(rupture, surface.dissolve);
      planetUniforms.uTime.value = time;
      planetUniforms.uCrustDissolve.value = surface.dissolve;
      planet.visible = surface.crustVisible && !space && planetView;
      planetRoot.clouds.visible =
        planetRoot.haze.visible =
        planetRoot.atmosphere.visible =
          planet.visible;
      planetRoot.clouds.rotation.y = time * 0.004;
      planetRoot.clouds.material.opacity = 0.95 * (1 - surface.dissolve);
      planetRoot.haze.material.opacity = 0.09 * (1 - surface.dissolve);
      planetRoot.atmosphere.material.uniforms.uOpacity.value =
        1 - surface.dissolve;
      fire.visible = !space && surface.fireVisible;
      fireMaterial.uniforms.uRupture.value = surface.dissolve;
      fireMaterial.uniforms.uDispersal.value = surface.dispersal;
      fireMaterial.uniforms.uTime.value = time;
      // Keep the fire beneath the crust until the textured surface has melted away.
      const exposedFire = smooth(
        ruptureTime,
        PLANET_RUPTURE.forest,
        PLANET_RUPTURE.burning,
      );
      fire.scale.setScalar(
        1 +
          exposedFire * 0.06 +
          surface.dispersal * 0.24 +
          rumble * Math.sin(ruptureTime * 18) * 0.008,
      );
      dust.visible = !space && surface.dustVisible;
      dustMaterial.uniforms.uAge.value = ruptureTime - PLANET_RUPTURE.burst;
      const blastAge = ruptureTime - PLANET_RUPTURE.burst;
      shockwaves.forEach((mesh, i) => {
        const age = blastAge - i * 0.18;
        mesh.visible = age >= 0 && age < 3.5 && !space;
        mesh.scale.setScalar(
          PLANET_RADIUS * (1.03 + Math.max(0, age) * (1.5 + i * 0.35)),
        );
        mesh.material.opacity =
          Math.max(0, 1 - age / 3.5) * (i === 1 ? 0.9 : 0.55);
      });
      blastLight.intensity =
        blastAge >= 0 && blastAge < 3.5 ? 170 * Math.exp(-blastAge * 0.7) : 0;
      debris.visible =
        !space && !forestView && !cockpitView && surface.dustVisible;
      if (debris.visible) {
        debrisMaterial.opacity = 1 - smooth(blastAge, 0.6, 2.8);
        debris.visible = debrisMaterial.opacity > 0;
      }
      if (debris.visible) {
        for (let i = 0; i < debris.count; i++) {
          const fragment = debrisFragments[i];
          dummy.position
            .copy(PLANET_CENTER)
            .addScaledVector(
              fragment.direction,
              PLANET_RADIUS + blastAge * fragment.speed,
            );
          dummy.rotation.set(
            i + blastAge * 0.35,
            i * 0.4 + blastAge * 0.18,
            i * 0.3,
          );
          dummy.scale.setScalar(fragment.size * (1 - surface.dispersal * 0.6));
          dummy.updateMatrix();
          debris.setMatrixAt(i, dummy.matrix);
        }
        debris.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      root.removeFromParent();
      starfield.dispose();
      disposeRoom(root);
      armorTextures.dispose();
    },
  };
}
