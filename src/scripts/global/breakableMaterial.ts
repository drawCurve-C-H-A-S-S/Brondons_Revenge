import * as THREE from 'three';
import type { DamageWeapon } from '../weapons/pistol.js';

/** The same corrosion-vein language identifies weapon requirements on every deck. */
export class BreakableMaterial extends THREE.MeshStandardMaterial {
  private readonly glow = {
    uBreakableTime: { value: 0 },
    uBreakableFlash: { value: 0 },
    uBreakableDamage: { value: 0 },
    uBreakableScan: { value: 0 },
    uBreakableColor: { value: new THREE.Color() },
  };

  constructor(weapon: DamageWeapon, glowHex?: number) {
    super({ color: weapon === 'pistol' ? 0x334c59 : 0x604632, roughness: 0.78, metalness: 0.3 });
    this.glow.uBreakableColor.value.setHex(glowHex ?? (weapon === 'pistol' ? 0x38bcff : 0xff781f));
    this.name = weapon === 'pistol' ? 'BlueBallisticBreakable' : 'OrangeMeleeBreakable';
    this.customProgramCacheKey = () => 'corroded-breakable-v1';
    this.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.glow);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        varying vec3 vBreakablePosition;
      `).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vBreakablePosition = position;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        varying vec3 vBreakablePosition;
        uniform float uBreakableTime, uBreakableFlash, uBreakableDamage, uBreakableScan;
        uniform vec3 uBreakableColor;
        float breakableHash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float breakableNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(breakableHash(i), breakableHash(i + vec3(1,0,0)), f.x),
            mix(breakableHash(i + vec3(0,1,0)), breakableHash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(breakableHash(i + vec3(0,0,1)), breakableHash(i + vec3(1,0,1)), f.x),
            mix(breakableHash(i + vec3(0,1,1)), breakableHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
      `).replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec3 corrosionPoint = vBreakablePosition * 4.5;
        float corrosion = breakableNoise(corrosionPoint) * 0.65
          + breakableNoise(corrosionPoint * 2.07 + 7.1) * 0.35;
        float veins = 1.0 - smoothstep(0.025, 0.13, abs(corrosion - 0.49));
        float pits = smoothstep(0.59, 0.76, breakableNoise(corrosionPoint * 3.0));
        float cracks = pow(1.0 - abs(breakableNoise(corrosionPoint * 1.8) * 2.0 - 1.0), 12.0);
        float pulse = 0.93 + 0.07 * sin(uBreakableTime * 1.7 - vBreakablePosition.y * 2.0);
        diffuseColor.rgb *= 0.78 + corrosion * 0.44;
        totalEmissiveRadiance += uBreakableColor * (0.22 + veins * 1.1 + pits * 0.35
          + cracks * uBreakableDamage) * pulse * (1.0 + uBreakableScan * 0.7);
        totalEmissiveRadiance += vec3(1.0, 0.86, 0.65) * uBreakableFlash;
      `);
    };
  }

  update(dt: number) {
    this.glow.uBreakableTime.value += dt;
    this.glow.uBreakableFlash.value = Math.max(0, this.glow.uBreakableFlash.value - dt * 5);
  }
  hit(damage = 1) { this.glow.uBreakableFlash.value = 1.8; this.glow.uBreakableDamage.value = damage; }
  setHighlighted(active: boolean) { this.glow.uBreakableScan.value = active ? 1 : 0; }
  reset() { this.glow.uBreakableFlash.value = 0; this.glow.uBreakableDamage.value = 0; }
}
