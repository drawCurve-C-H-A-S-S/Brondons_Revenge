import * as THREE from 'three';
import { loadMCModel } from '../../core/loader.js';
import { PLANET_RUPTURE, cinematicProgress, samplePlanetAftermath } from '../../scripts/finaleChoreography.js';
import { captureFinaleResources, normalizeFinaleActor } from './finaleActors.js';
import { RESCUE_SITE } from './rescueSite.js';
import { disposeRoom } from './shipRoom.js';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function createFinaleAftermath(scene: THREE.Scene, boy: THREE.Group, forestReady: Promise<void>, reducedMotion: boolean) {
  const root = new THREE.Group(); root.name = 'PlanetCollapseAftermath'; scene.add(root);
  const forest = new THREE.Group(); forest.name = 'BurningRescueClearing'; root.add(forest);
  const cockpit = new THREE.Group(); cockpit.name = 'PrimeFrameCockpitInterior'; root.add(cockpit);
  forest.visible = cockpit.visible = false;
  const burnUniforms = { uBurn: { value: 0 }, uScorchTime: { value: 0 } };
  const fireUniforms = { uTime: { value: 0 }, uPower: { value: 0 } };
  const fireMaterial = new THREE.ShaderMaterial({
    uniforms: fireUniforms,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uPower; varying vec2 vUv;
      void main() {
        float wave = sin(vUv.y * 14.0 - uTime * 4.8) * 0.1 + sin(vUv.y * 25.0 - uTime * 7.1) * 0.045;
        float width = (0.49 - vUv.y * 0.38) * (0.8 + 0.2 * sin(uTime * 3.0 + vUv.y * 15.0));
        float flame = 1.0 - smoothstep(width * 0.5, width, abs(vUv.x - 0.5 + wave * vUv.y));
        flame *= (1.0 - smoothstep(0.7, 1.0, vUv.y)) * smoothstep(0.0, 0.08, vUv.y);
        vec3 tint = mix(vec3(2.0, 0.75, 0.12), vec3(0.9, 0.045, 0.008), vUv.y);
        gl_FragColor = vec4(tint, flame * uPower * 0.72);
      }`,
    transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const fireGeometry = new THREE.PlaneGeometry(1, 1);
  fireGeometry.translate(0, 0.5, 0);
  for (let i = 0; i < 22; i++) {
    const angle = i * 2.399, radius = i < 6 ? 0.65 + i * 0.14 : 5 + i % 7 * 1.8;
    const flame = new THREE.Mesh(fireGeometry, fireMaterial);
    flame.name = i < 6 ? 'BrendanSurfaceFlame' : 'ForestWildfire';
    flame.position.copy(RESCUE_SITE.boy).add(V(Math.cos(angle) * radius, 0.06, Math.sin(angle) * radius));
    flame.scale.set(i < 6 ? 0.55 : 2.2 + i % 3, i < 6 ? 1.3 : 4 + i % 5, 1);
    flame.rotation.y = angle;
    forest.add(flame);
    const cross = flame.clone(); cross.rotation.y += Math.PI / 2; forest.add(cross);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(17, 48), new THREE.MeshStandardMaterial({
    color: 0x171211, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false,
  }));
  ash.name = 'ScorchedForestFloor'; ash.rotation.x = -Math.PI / 2;
  ash.position.copy(RESCUE_SITE.boy).y = 0.04; forest.add(ash);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x201c1b, transparent: true, opacity: 0.14, depthWrite: false });
  const smokeGeometry = new THREE.SphereGeometry(1, 10, 8);
  const smoke = Array.from({ length: 20 }, (_, i) => {
    const mesh = new THREE.Mesh(smokeGeometry, smokeMaterial);
    mesh.name = 'ForestSmoke'; forest.add(mesh); return { mesh, index: i };
  });
  const emberPositions = new Float32Array(110 * 3), emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({
    color: 0xffa65b, size: 0.055, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false,
  }));
  embers.name = 'ForestEmbers'; embers.frustumCulled = false; forest.add(embers);
  const fireLight = new THREE.PointLight(0xff6b27, 0, 34, 1.4);
  fireLight.position.copy(RESCUE_SITE.boy).add(V(-1.2, 2.1, 1)); forest.add(fireLight);

  const steel = new THREE.MeshStandardMaterial({ color: 0x111b26, metalness: 0.85, roughness: 0.38 });
  const padding = new THREE.MeshStandardMaterial({ color: 0x252b34, roughness: 0.88 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x687d8a, metalness: 0.9, roughness: 0.25 });
  const instruments = new THREE.MeshBasicMaterial({ color: 0x4492ae, toneMapped: false });
  const warning = new THREE.MeshBasicMaterial({ color: 0xb33135, toneMapped: false });
  function box(size: THREE.Vector3, position: THREE.Vector3, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(position); cockpit.add(mesh); return mesh;
  }
  box(V(3.6, 0.16, 3.8), V(0, -0.12, 0), steel);
  box(V(3.6, 3.2, 0.2), V(0, 1.35, -1.65), steel);
  box(V(0.82, 1.3, 0.2), V(0, 1.05, -0.75), padding).rotation.x = -0.12;
  box(V(0.85, 0.16, 0.7), V(0, 0.48, -0.36), padding);
  for (const sign of [-1, 1]) {
    box(V(0.17, 3, 0.2), V(sign * 1.18, 1.4, 0.78), trim).rotation.z = sign * 0.12;
    box(V(0.65, 0.32, 1.25), V(sign * 0.9, 0.73, 0.35), steel);
    for (let i = 0; i < 5; i++) {
      box(V(0.38, 0.025, 0.085), V(sign * 0.9, 0.91, -0.05 + i * 0.16), i === 0 ? warning : instruments);
    }
    box(V(0.055, 2, 0.035), V(sign * 0.85, 1.3, -1.52), instruments);
  }
  box(V(2.4, 0.18, 0.2), V(0, 2.85, 0.72), trim);
  const cockpitKey = new THREE.PointLight(0xff8b56, 3.2, 7, 1.1);
  cockpitKey.position.set(-0.8, 1.8, 1.3); cockpit.add(cockpitKey);
  const cockpitFill = new THREE.PointLight(0x6ebde8, 2.3, 6, 1);
  cockpitFill.position.set(0.9, 1.3, 0.6); cockpit.add(cockpitFill);
  const cockpitRim = new THREE.PointLight(0xb63a48, 2, 6, 1);
  cockpitRim.position.set(0, 1.8, -1.1); cockpit.add(cockpitRim);

  let disposed = false, pilotModel: THREE.Object3D | null = null, pilotHead: THREE.Object3D | null = null;
  let pilotMixer: THREE.AnimationMixer | null = null, pilotResources: ReturnType<typeof captureFinaleResources> | null = null;
  let sitting: THREE.AnimationAction | null = null, talking: THREE.AnimationAction | null = null;
  const headWorld = new THREE.Quaternion(), headParent = new THREE.Quaternion(), headTilt = new THREE.Quaternion();
  const pilot = new THREE.Group(); pilot.name = 'BrondonCockpitPilot'; cockpit.add(pilot);
  const boyBones: Array<{ bone: THREE.Object3D; rest: THREE.Quaternion }> = [];
  const ready = Promise.all([forestReady, loadMCModel()]).then(([, asset]) => {
    pilotResources = captureFinaleResources(asset.scene);
    if (disposed) { pilotResources.dispose(); return; }
    if (!boy.children.length) throw new Error('The final surface transmission requires the boy.glb forest actor');
    boy.traverse(node => {
      if (node instanceof THREE.Bone) boyBones.push({ bone: node, rest: node.quaternion.clone() });
      if (!(node instanceof THREE.Mesh)) return;
      if (node.name === 'Plane' && !(node instanceof THREE.SkinnedMesh)) { node.visible = false; return; }
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.roughness = 0.96;
        material.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, burnUniforms);
          shader.vertexShader = 'varying vec3 vScorchP;\n' + shader.vertexShader
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvScorchP = position;');
          shader.fragmentShader = 'varying vec3 vScorchP; uniform float uBurn; uniform float uScorchTime;\n' + shader.fragmentShader
            .replace('#include <color_fragment>', `#include <color_fragment>
              float charNoise = fract(sin(dot(floor(vScorchP * 38.0), vec3(12.9, 78.2, 36.4))) * 43758.5);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.012, 0.011), uBurn * (0.92 + charNoise * 0.08));`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              float ember = pow(max(0.0, sin(vScorchP.y * 53.0 + vScorchP.x * 41.0 + uScorchTime)), 32.0);
              totalEmissiveRadiance += vec3(0.85, 0.065, 0.008) * ember * uBurn * (1.0 - uBurn * 0.65);`);
        };
        material.customProgramCacheKey = () => 'finale-brendan-scorched-v1';
        material.needsUpdate = true;
      }
    });
    pilotModel = asset.scene; pilot.add(normalizeFinaleActor(pilotModel, 1.83)); pilot.position.z = -0.3;
    pilotModel.traverse(node => { if (/visor|lens/i.test(node.name)) node.visible = false; });
    pilotHead = pilotModel.getObjectByName('Head') ?? null;
    const seated = asset.animations.find(clip => clip.name === 'Sitting_Idle_Loop');
    const speech = asset.animations.find(clip => clip.name === 'Sitting_Talking_Loop');
    if (!pilotHead || !seated || !speech) throw new Error('Brondon needs his head bone and seated dialogue animations for the cockpit close-up');
    pilotMixer = new THREE.AnimationMixer(pilotModel);
    sitting = pilotMixer.clipAction(seated).play(); talking = pilotMixer.clipAction(speech).play();
  });

  return { root, forest, cockpit, ready,
    update(phaseTime: number, time: number, hero: THREE.Object3D) {
      const state = samplePlanetAftermath(phaseTime);
      forest.visible = state.forest; cockpit.visible = state.cockpit || (phaseTime >= PLANET_RUPTURE.returnToDuel && state.orbit < 0.3);
      boy.visible = state.forest;
      if (state.forest) {
        burnUniforms.uBurn.value = state.burn; burnUniforms.uScorchTime.value = time;
        const collapse = cinematicProgress(phaseTime, PLANET_RUPTURE.scorch + 0.7, PLANET_RUPTURE.forestEnd - 1);
        boy.rotation.z = -collapse * 1.48; boy.position.y = collapse * 0.16;
        for (const { bone, rest } of boyBones) {
          bone.quaternion.copy(rest);
          if (bone.name === 'head') bone.rotateX(0.12 + collapse * 0.2);
          if (bone.name === 'spine') bone.rotateZ(collapse * 0.22);
          if (bone.name === 'upper_armL') bone.rotateZ(-collapse * 0.32);
          if (bone.name === 'upper_armR') bone.rotateZ(collapse * 0.24);
          if (bone.name === 'thighL') bone.rotateX(-collapse * 0.35);
          if (bone.name === 'shinL') bone.rotateX(collapse * 0.65);
          if (bone.name === 'thighR') bone.rotateX(collapse * 0.2);
          if (bone.name === 'shinR') bone.rotateX(collapse * 0.32);
        }
        fireUniforms.uTime.value = reducedMotion ? 0 : time;
        fireUniforms.uPower.value = 0.3 + state.burn * 0.7;
        fireLight.intensity = 16 + state.burn * 25 + (reducedMotion ? 0 : Math.sin(time * 4.3) * 3);
        for (const { mesh, index } of smoke) {
          const age = ((time * 0.23 + index * 0.19) % 1);
          const angle = index * 2.399, radius = 3 + index % 4 * 2;
          mesh.position.copy(RESCUE_SITE.boy).add(V(Math.cos(angle) * radius + age * 2, 1 + age * 12, Math.sin(angle) * radius));
          mesh.scale.setScalar(0.8 + age * 3);
        }
        for (let i = 0; i < emberPositions.length / 3; i++) {
          const age = (time * 0.18 + i * 0.137) % 1, angle = i * 2.399;
          V(RESCUE_SITE.boy.x + Math.cos(angle) * (2 + i % 7) + age * 2, age * 10 + 0.1,
            RESCUE_SITE.boy.z + Math.sin(angle) * (2 + i % 7)).toArray(emberPositions, i * 3);
        }
        emberGeometry.getAttribute('position').needsUpdate = true;
      }
      if (cockpit.visible) {
        cockpit.position.copy(hero.position).add(V(0, 10.6, 0));
        cockpit.rotation.y = hero.rotation.y;
        if (pilotMixer && sitting && talking) {
          const speaking = cinematicProgress(phaseTime, PLANET_RUPTURE.cockpit + 0.4, PLANET_RUPTURE.cockpit + 1.1);
          sitting.setEffectiveWeight(1 - speaking * 0.85); talking.setEffectiveWeight(speaking * 0.85);
          sitting.time = Math.max(0, phaseTime - PLANET_RUPTURE.cockpit) % sitting.getClip().duration;
          talking.time = Math.max(0, phaseTime - PLANET_RUPTURE.cockpit) % talking.getClip().duration;
          sitting.paused = talking.paused = true; pilotMixer.update(0);
          if (pilotHead?.parent) {
            pilotHead.getWorldQuaternion(headWorld);
            headTilt.setFromAxisAngle(V(1, 0, 0).applyQuaternion(cockpit.quaternion), 0.16 * (1 - state.resolve) - state.resolve * 0.06);
            headWorld.premultiply(headTilt); pilotHead.parent.getWorldQuaternion(headParent);
            pilotHead.quaternion.copy(headParent.invert().multiply(headWorld));
          }
        }
        cockpitKey.intensity = 3.2 * (1 - state.resolve * 0.7);
        cockpitFill.intensity = 2.3 + state.resolve * 1.5;
        cockpitRim.intensity = 2 + state.grief;
        root.updateMatrixWorld(true);
      }
    },
    getBoyFocus(out = new THREE.Vector3()) {
      const head = boy.getObjectByName('head');
      return head ? head.getWorldPosition(out) : boy.localToWorld(out.set(0, 1.05, 0));
    },
    getPilotFace(out = new THREE.Vector3()) {
      if (!pilotHead) return cockpit.localToWorld(out.set(0, 1.6, -0.2));
      pilotHead.getWorldPosition(out);
      return out.add(V(0, 0.045, 0.08).applyQuaternion(cockpit.quaternion));
    },
    getPilotCamera(time: number, out = new THREE.Vector3()) {
      const close = cinematicProgress(time, PLANET_RUPTURE.cockpit, PLANET_RUPTURE.returnToDuel);
      if (!pilotHead) return cockpit.localToWorld(out.set(0.2, 1.65, 0.9));
      pilotHead.getWorldPosition(out);
      return out.add(V(0.25 - close * 0.13, 0.13, 0.95 - close * 0.2).applyQuaternion(cockpit.quaternion));
    },
    dispose() {
      if (disposed) return; disposed = true;
      pilotMixer?.stopAllAction();
      if (pilotMixer && pilotModel) pilotMixer.uncacheRoot(pilotModel);
      pilotResources?.dispose(); root.removeFromParent(); disposeRoom(root);
    },
  };
}
