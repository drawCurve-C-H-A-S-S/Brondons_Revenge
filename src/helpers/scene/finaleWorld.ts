import * as THREE from 'three';
import { disposeRoom } from './shipRoom.js';
import { createArmorTextures, createEnergyMaterial } from './finaleMaterials.js';
import { SUDOERS_5 } from './finaleActors.js';
import { PLANET_RUPTURE, activeStudent, samplePlanetBreaker } from '../../scripts/finaleChoreography.js';
import { createEarthTextures, createEarthGroup } from '../../scripts/earthTexture.js';

export const PLANET_RADIUS = 340;
export const SPACE_ALTITUDE = 95;
export const FINALE_ROOFTOP = Object.freeze({ x: 0, y: 32.4, z: -71, width: 70, depth: 33 });
export const FINALE_DECK_Y = 21.2;
export const PLANET_CENTER = new THREE.Vector3(0, -PLANET_RADIUS - 2, 0);
export function finaleBattlePoint(x: number, y = 0, altitude = 0) {
  return new THREE.Vector3(FINALE_ROOFTOP.x + x * 0.9701425, FINALE_DECK_Y + y + altitude,
    FINALE_ROOFTOP.z - x * 0.2425356);
}
export const FINALE_BATTLE_YAW = Math.atan2(0.9701425, -0.2425356);
const smooth = THREE.MathUtils.smootherstep;
const clamp = THREE.MathUtils.clamp;
function random(seed: number) { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); }

export function createFinaleWorld(scene: THREE.Scene, { facilityRoof }: { facilityRoof?: THREE.Mesh } = {}) {
  const root = new THREE.Group();
  root.name = 'RescueSiteSummitAndOrbit';
  scene.add(root);
  const roofFog = scene.fog;
  roofFog?.color.set(0x273138);
  const roofBackground = scene.background instanceof THREE.Color ? scene.background : new THREE.Color(0x698475);
  scene.background = roofBackground;
  const spaceBackground = new THREE.Color(0x030711);
  const nightBackground = new THREE.Color(0x091121);
  const rooftopDestructionColor = new THREE.Color(0x2c3444);
  const armorTextures = createArmorTextures();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x697783, metalness: 0.9, roughness: 0.48,
    map: armorTextures.map, normalMap: armorTextures.normalMap,
    normalScale: new THREE.Vector2(0.26, 0.26), roughnessMap: armorTextures.roughnessMap,
  });
  const black = new THREE.MeshPhysicalMaterial({ color: 0x121923, metalness: 0.86, roughness: 0.42, clearcoat: 0.7 });
  const roofCenter = new THREE.Vector3(FINALE_ROOFTOP.x, FINALE_ROOFTOP.y, FINALE_ROOFTOP.z);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(70, 0.4, 32), metal);
  floor.name = 'FacilityTopFloor';
  floor.position.set(FINALE_ROOFTOP.x, FINALE_DECK_Y - 0.2, FINALE_ROOFTOP.z);
  floor.castShadow = floor.receiveShadow = true;
  root.add(floor);
  const upperWalls = new THREE.Group(); upperWalls.name = 'FacilitySummitWalls';
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 32), black);
    wall.position.set(side * 35, 28, -71); upperWalls.add(wall);
  }
  const rearWall = new THREE.Mesh(new THREE.BoxGeometry(70, 8, 1), black);
  rearWall.position.set(0, 28, -87); upperWalls.add(rearWall);
  root.add(upperWalls);

  const roofPieces: Array<{ mesh: THREE.Mesh; origin: THREE.Vector3; velocity: THREE.Vector3; axis: THREE.Vector3 }> = [];
  if (facilityRoof) {
    facilityRoof.geometry.computeBoundingBox();
    const bounds = new THREE.Box3().setFromObject(facilityRoof);
    const size = bounds.getSize(new THREE.Vector3());
    const columns = 5, rows = 3;
    const fragmentGeometry = new THREE.BoxGeometry(size.x / columns, size.y, size.z / rows);
    const sourceMaterial = Array.isArray(facilityRoof.material) ? facilityRoof.material[0] : facilityRoof.material;
    const fragmentMaterial = sourceMaterial.clone();
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const mesh = new THREE.Mesh(fragmentGeometry, fragmentMaterial);
      const origin = new THREE.Vector3(
        bounds.min.x + (column + 0.5) * size.x / columns,
        bounds.min.y + size.y / 2,
        bounds.min.z + (row + 0.5) * size.z / rows,
      );
      mesh.position.copy(origin);
      const direction = new THREE.Vector3(origin.x - roofCenter.x, 0, origin.z - roofCenter.z);
      if (direction.lengthSq() < 0.001) direction.set(Math.cos(column), 0, Math.sin(row + 1));
      direction.normalize();
      const velocity = direction.multiplyScalar(36 + random(row * columns + column) * 20);
      velocity.y = 17 + random(row * columns + column + 13) * 12;
      const axis = new THREE.Vector3(direction.z, 0.35 + random(column + row * 5) * 0.6, -direction.x).normalize();
      mesh.visible = false;
      root.add(mesh);
      roofPieces.push({ mesh, origin, velocity, axis });
    }
  }

  const studentLights = SUDOERS_5.map((student, i) => {
    const spot = new THREE.SpotLight(0xb8bec7, 0, 18, 0.16, 0.68, 1);
    spot.name = `${student.name}_CeilingSpotlight`;
    spot.position.set((i - 2) * 2.45, FINALE_ROOFTOP.y - 0.65, FINALE_ROOFTOP.z - 3.5);
    spot.target.position.set((i - 2) * 2.45, FINALE_DECK_Y + 0.7, FINALE_ROOFTOP.z - 3.5);
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.22, 12), black);
    fixture.position.copy(spot.position).add(new THREE.Vector3(0, 0.15, 0));
    upperWalls.add(fixture);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16),
      new THREE.MeshBasicMaterial({ color: 0xb8bec7, toneMapped: false }));
    lens.rotation.x = -Math.PI / 2; lens.position.copy(spot.position).add(new THREE.Vector3(0, 0.03, 0));
    upperWalls.add(lens);
    root.add(spot, spot.target);
    return spot;
  });
  const beams = SUDOERS_5.map((_student, i) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xa8b1bd) }, uTime: { value: 0 }, uPower: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower; varying vec2 vUv;
        void main() { float pulse = 0.95 + 0.05 * sin(uTime * 0.8 + vUv.y * 7.0);
          gl_FragColor = vec4(uColor, (1.0 - vUv.y) * uPower * pulse * 0.055); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const height = FINALE_ROOFTOP.y - 0.7 - FINALE_DECK_Y;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 1.25, height, 18, 1, true), material);
    mesh.position.set((i - 2) * 2.45, FINALE_DECK_Y + height / 2, FINALE_ROOFTOP.z - 3.5);
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 }, uNight: { value: 0 } },
    vertexShader: `varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uFade; uniform float uNight; varying vec3 vDirection; void main() {
      float elevation = normalize(vDirection).y;
      float gradient = smoothstep(-0.15, 0.88, elevation);
      vec3 dusk = mix(vec3(0.16, 0.14, 0.13), vec3(0.055, 0.08, 0.11), gradient);
      vec3 night = mix(vec3(0.055, 0.075, 0.115), vec3(0.009, 0.018, 0.042), gradient);
      vec3 color = mix(dusk, night, uNight);
      gl_FragColor = vec4(color, uFade); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false,
  }));
  sky.renderOrder = -100;
  root.add(sky);

  const planetRoot = createEarthGroup(root, PLANET_CENTER, PLANET_RADIUS, createEarthTextures());
  planetRoot.name = 'Earth';
  const planet = planetRoot.surface, planetMaterial = planet.material;
  const planetUniforms = { uRupture: { value: 0 }, uTime: { value: 0 } };
  planetMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, planetUniforms);
    shader.vertexShader = 'varying vec2 vPlanetUv;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlanetUv = uv;');
    shader.fragmentShader = 'varying vec2 vPlanetUv; uniform float uRupture; uniform float uTime;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 grid = abs(fract(vPlanetUv * vec2(35.0, 19.0) + sin(vPlanetUv.yx * 29.0) * 0.32) - 0.5);
      float crack = smoothstep(0.455, 0.49, max(grid.x, grid.y));
      totalEmissiveRadiance += vec3(1.0, 0.17, 0.025) * crack * uRupture * (2.0 + sin(uTime * 8.0) * 0.25);`);
  };
  planetMaterial.customProgramCacheKey = () => 'finale-earth-fracture-v3';
  const fireMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRupture: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vUv = uv;
        vNormal = normalize(normalMatrix * normal); vView = -p.xyz; gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform float uTime; uniform float uRupture; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        vec2 flow = vec2(vUv.x * 22.0, vUv.y * 12.0 - uTime * 0.2);
        float turbulence = noise(flow) * 0.62 + noise(flow * 2.1 + vec2(0.0, -uTime * 0.25)) * 0.38;
        float filaments = smoothstep(0.2, 0.88, turbulence + 0.18 * sin(vUv.y * 44.0 - uTime * 1.7));
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        vec3 color = mix(vec3(0.48, 0.025, 0.008), vec3(1.65, 0.3, 0.025), filaments);
        color = mix(color, vec3(2.4, 1.05, 0.24), smoothstep(0.7, 1.0, filaments + rim * 0.25));
        gl_FragColor = vec4(color, uRupture * (0.25 + filaments * 0.58 + rim * 0.22)); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const fire = new THREE.Mesh(new THREE.SphereGeometry(PLANET_RADIUS * 0.94, 56, 36), fireMaterial);
  fire.visible = false;
  planetRoot.add(fire);
  const shockwaves = Array.from({ length: 3 }, (_, index) => {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? 0xfff2c1 : 0xff7132, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.018 + index * 0.009, 8, 128), material);
    mesh.rotation.set(Math.PI / 2 + index * 0.34, index * 0.55, index * 0.18);
    mesh.visible = false;
    planetRoot.add(mesh);
    return mesh;
  });
  const blastLight = new THREE.PointLight(0xff8d43, 0, 1800, 0.7);
  blastLight.position.set(0, PLANET_RADIUS * 0.7, 0);
  planetRoot.add(blastLight);

  const fragments: { mesh: THREE.Mesh; direction: THREE.Vector3 }[] = [];
  for (let band = 0; band < 3; band++) for (let sector = 0; sector < 8; sector++) {
    const phi = sector * Math.PI / 4, theta = band * Math.PI / 3;
    const geometry = new THREE.SphereGeometry(PLANET_RADIUS, 12, 10, phi, Math.PI / 4, theta, Math.PI / 3);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, sector / 8 + uv.getX(i) / 8, 1 - (band + 1 - uv.getY(i)) / 3);
    const mesh = new THREE.Mesh(geometry, planetMaterial);
    mesh.visible = false;
    planetRoot.add(mesh);
    const middlePhi = phi + Math.PI / 8, middleTheta = theta + Math.PI / 6;
    fragments.push({
      mesh,
      direction: new THREE.Vector3(-Math.cos(middlePhi) * Math.sin(middleTheta),
        Math.cos(middleTheta), Math.sin(middlePhi) * Math.sin(middleTheta)),
    });
  }

  const starsGeometry = new THREE.BufferGeometry(), starPositions = new Float32Array(2300 * 3), starColors = starPositions.slice();
  const point = new THREE.Vector3(), color = new THREE.Color();
  for (let i = 0; i < 2300; i++) {
    const phi = random(i * 3) * Math.PI * 2, cosine = random(i * 3 + 1) * 2 - 1, sine = Math.sqrt(1 - cosine * cosine);
    point.set(Math.cos(phi) * sine, cosine, Math.sin(phi) * sine).multiplyScalar(2100 + random(i * 3 + 2) * 2100);
    point.toArray(starPositions, i * 3);
    color.setHSL(0.55 + random(i + 3) * 0.2, 0.12 + random(i + 4) * 0.25, 0.65 + random(i + 5) * 0.3).toArray(starColors, i * 3);
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starsGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  const starsMaterial = new THREE.PointsMaterial({
    size: 3.2, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  root.add(stars);

  const debrisGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rockVertices = debrisGeometry.getAttribute('position');
  for (let i = 0; i < rockVertices.count; i++) {
    point.fromBufferAttribute(rockVertices, i);
    const erosion = 0.82 + 0.19 * Math.sin(point.x * 9.1 + point.z * 5.7) + 0.14 * Math.cos(point.y * 11.3 - point.x * 3.4);
    rockVertices.setXYZ(i, point.x * erosion, point.y * erosion, point.z * erosion);
  }
  debrisGeometry.computeVertexNormals();
  const rockBytes = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const grain = random(y * 128 + x), strata = Math.sin(x * 0.13 + Math.sin(y * 0.08) * 3);
    const tone = Math.round(87 + grain * 42 + strata * 15);
    rockBytes.set([tone, Math.round(tone * 0.94), Math.round(tone * 0.88), 255], (y * 128 + x) * 4);
  }
  const rockMap = new THREE.DataTexture(rockBytes, 128, 128, THREE.RGBAFormat);
  rockMap.colorSpace = THREE.SRGBColorSpace; rockMap.wrapS = rockMap.wrapT = THREE.RepeatWrapping;
  rockMap.needsUpdate = true;
  const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0xb1a698, map: rockMap, metalness: 0.02, roughness: 0.98, flatShading: true });
  const debris = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, 72);
  debris.name = 'EarthRockDebris';
  debris.visible = false;
  root.add(debris);
  const dummy = new THREE.Object3D();

  const bomb = new THREE.Group(); bomb.name = 'Sudoers5PlanetBreaker'; bomb.visible = false;
  const bombCore = new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 2), black);
  const bombEnergy = createEnergyMaterial(0xc74738);
  bomb.add(bombCore);
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.82, 0.12, 8, 40), bombEnergy);
    band.rotation.set(i * Math.PI / 3, i * Math.PI / 2, i * 0.5); bomb.add(band);
  }
  root.add(bomb);
  const bombTrail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.55, 1, 12, 1, true), createEnergyMaterial(0xff8c39));
  bombTrail.visible = false; root.add(bombTrail);
  const meteorStreaks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 4),
    new THREE.MeshBasicMaterial({ color: 0xe3d9d0, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }), 12);
  meteorStreaks.visible = false; meteorStreaks.frustumCulled = false; root.add(meteorStreaks);
  let releasePosition: THREE.Vector3 | null = null;
  const impactPosition = PLANET_CENTER.clone().add(new THREE.Vector3(0, PLANET_RADIUS, 0));
  const bombDirection = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  return { root, floor, planet, planetRoot, bomb, studentLights,
    lightStudent(index: number, position: THREE.Vector3) {
      const spot = studentLights[index], beam = beams[index];
      if (!spot || !beam) throw new RangeError(`Missing ceiling spotlight for student ${index}`);
      spot.target.position.copy(position).add(new THREE.Vector3(0, 0.8, 0));
      const direction = new THREE.Vector3().copy(spot.position).sub(position);
      beam.position.copy(spot.position).lerp(position, 0.5);
      beam.quaternion.setFromUnitVectors(up, direction.normalize());
    },
    updateBomb(phaseTime: number, hands: THREE.Vector3) {
      bomb.visible = phaseTime >= PLANET_RUPTURE.materialize && phaseTime < PLANET_RUPTURE.impact;
      bombTrail.visible = meteorStreaks.visible = false;
      if (phaseTime < 0) { releasePosition = null; return; }
      if (phaseTime < PLANET_RUPTURE.release) {
        bomb.position.copy(hands).add(new THREE.Vector3(0, 3.8, 0));
      } else {
        if (!releasePosition) {
          releasePosition = hands.clone().add(new THREE.Vector3(0, 3.8, 0));
          impactPosition.copy(releasePosition).sub(PLANET_CENTER).normalize().multiplyScalar(PLANET_RADIUS).add(PLANET_CENTER);
        }
        const origin: [number, number, number] = [releasePosition.x, releasePosition.y, releasePosition.z];
        const impact: [number, number, number] = [impactPosition.x, impactPosition.y, impactPosition.z];
        bomb.position.fromArray(samplePlanetBreaker(phaseTime, origin, impact));
        const previous = new THREE.Vector3().fromArray(samplePlanetBreaker(phaseTime - 0.07, origin, impact));
        bombDirection.copy(bomb.position).sub(previous);
        const length = Math.min(100, bombDirection.length() * 8);
        bombTrail.visible = bomb.visible && length > 0.1;
        bombDirection.normalize();
        bombTrail.position.copy(bomb.position).addScaledVector(bombDirection, -length * 0.5);
        bombTrail.scale.set(2.2, Math.max(0.001, length), 2.2);
        if (bombDirection.lengthSq() > 0) bombTrail.quaternion.setFromUnitVectors(up, bombDirection);
        bombTrail.material.uniforms.uTime.value = phaseTime;
        meteorStreaks.visible = bomb.visible && phaseTime > PLANET_RUPTURE.slam + 0.2;
        if (meteorStreaks.visible) {
          for (let i = 0; i < meteorStreaks.count; i++) {
            const angle = i * 2.399, radius = 8 + random(i) * 15;
            dummy.position.copy(bomb.position).add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
              .addScaledVector(bombDirection, -10 - random(i + 1) * 50);
            dummy.quaternion.setFromUnitVectors(up, bombDirection);
            dummy.scale.set(1, 14 + random(i + 2) * 40, 1); dummy.updateMatrix();
            meteorStreaks.setMatrixAt(i, dummy.matrix);
          }
          meteorStreaks.instanceMatrix.needsUpdate = true;
        }
      }
      bomb.rotation.set(phaseTime * 0.5, phaseTime * 1.1, phaseTime * 0.28);
      bombEnergy.uniforms.uTime.value = phaseTime;
      bomb.scale.setScalar(smooth(phaseTime, PLANET_RUPTURE.materialize, PLANET_RUPTURE.release - 0.3)
        * (1.1 + smooth(phaseTime, PLANET_RUPTURE.release, PLANET_RUPTURE.apex) * 2.8));
    },
    getBombPosition: () => bomb.position.clone(),
    getPlanetImpact: () => impactPosition.clone(),
    update(time: number, rupture: number, space: boolean, reveal = 0, roofBlast = -1, ruptureTime = -1, night = 0) {
      const planetView = ruptureTime >= PLANET_RUPTURE.wide;
      floor.visible = !space && !planetView;
      upperWalls.visible = roofBlast < 0.25 && !space && !planetView;
      if (facilityRoof) facilityRoof.visible = roofBlast < 0.25 && !space && !planetView;
      for (let i = 0; i < roofPieces.length; i++) {
        const piece = roofPieces[i];
        const elapsed = roofBlast - 0.25;
        piece.mesh.visible = elapsed >= 0 && elapsed < 1.6 && !space && !planetView;
        if (!piece.mesh.visible) continue;
        piece.mesh.position.copy(piece.origin).addScaledVector(piece.velocity, elapsed);
        piece.mesh.position.y -= 4.9 * elapsed * elapsed;
        piece.mesh.rotation.set(piece.axis.x * elapsed * 1.3, piece.axis.y * elapsed, piece.axis.z * elapsed * 1.3);
      }
      sky.visible = !space && !planetView && rupture < 1;
      scene.fog = space || planetView ? null : roofFog;
      if (space || planetView) {
        roofBackground.copy(spaceBackground);
      } else {
        roofBackground.set(0x263138).lerp(nightBackground, night).lerp(rooftopDestructionColor, smooth(rupture, 0, 1));
      }
      roofFog?.color.copy(roofBackground);
      sky.material.uniforms.uFade.value = 1 - smooth(rupture, 0.15, 0.65);
      sky.material.uniforms.uNight.value = night;
      studentLights.forEach((spot, i) => {
        const selected = activeStudent(reveal, 'reveal') === i;
        spot.intensity = (1 - smooth(roofBlast, 0.15, 0.5))
          * smooth(reveal, 2.15 + i * 0.18, 4 + i * 0.18) * (selected ? 58 : 28);
        beams[i].visible = spot.intensity > 0.1;
        beams[i].material.uniforms.uTime.value = time;
        beams[i].material.uniforms.uPower.value = spot.intensity / 58;
      });
      starsMaterial.opacity = space ? 0.95 : Math.max(night * 0.48, smooth(ruptureTime, PLANET_RUPTURE.escape, PLANET_RUPTURE.wide + 1));
      planetUniforms.uRupture.value = rupture;
      planetUniforms.uTime.value = time;
      planet.visible = rupture < 0.36;
      planetRoot.clouds.visible = planetRoot.haze.visible = planetRoot.atmosphere.visible = planet.visible;
      planetRoot.clouds.rotation.y = time * 0.004;
      planetRoot.clouds.material.opacity = 0.95 * (1 - rupture);
      planetRoot.haze.material.opacity = 0.09 * (1 - rupture);
      planetRoot.atmosphere.material.uniforms.uOpacity.value = 1 - rupture;
      fire.visible = !space && rupture >= 0.04;
      fireMaterial.uniforms.uRupture.value = smooth(rupture, 0.04, 0.18);
      fireMaterial.uniforms.uTime.value = time;
      fire.scale.setScalar(1 + smooth(rupture, 0.4, 0.8) * 0.16);
      fragments.forEach((fragment, i) => {
        fragment.mesh.visible = rupture >= 0.08 && !space;
        fragment.mesh.position.copy(fragment.direction).multiplyScalar(smooth(rupture, 0.08, 1) * (280 + random(i) * 240));
        fragment.mesh.rotation.set(rupture * Math.sin(i) * 0.35, rupture * Math.cos(i) * 0.35, rupture * Math.sin(i * 3) * 0.35);
      });
      const blastAge = ruptureTime - PLANET_RUPTURE.burst;
      shockwaves.forEach((mesh, i) => {
        const age = blastAge - i * 0.18;
        mesh.visible = age >= 0 && age < 3.5 && !space;
        mesh.scale.setScalar(PLANET_RADIUS * (1.03 + Math.max(0, age) * (1.5 + i * 0.35)));
        mesh.material.opacity = Math.max(0, 1 - age / 3.5) * (i === 1 ? 0.9 : 0.55);
      });
      blastLight.intensity = blastAge >= 0 && blastAge < 3.5 ? 170 * Math.exp(-blastAge * 0.7) : 0;
      debris.visible = space;
      if (space) {
        for (let i = 0; i < debris.count; i++) {
          const angle = i * 2.399 + time * (0.008 + random(i) * 0.01);
          const radius = 65 + random(i + 9) * 110;
          dummy.position.set(Math.cos(angle) * radius, SPACE_ALTITUDE + Math.sin(angle * 0.7) * 45,
            FINALE_ROOFTOP.z + Math.sin(angle) * 80);
          dummy.rotation.set(i + time * 0.035, i * 0.4 + time * 0.018, i * 0.3);
          const size = 1.3 + random(i + 17) * 5.8;
          dummy.scale.set(size * (0.85 + random(i + 20) * 0.35), size, size * (0.8 + random(i + 21) * 0.4));
          dummy.updateMatrix();
          debris.setMatrixAt(i, dummy.matrix);
          debris.setColorAt(i, color.setHSL(0.08 + random(i + 30) * 0.04, 0.08, 0.5 + random(i + 31) * 0.35));
        }
        debris.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      root.removeFromParent();
      studentLights.forEach(spot => { spot.removeFromParent(); spot.target.removeFromParent(); });
      disposeRoom(root);
      armorTextures.dispose();
    },
  };
}
