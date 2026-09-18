// items/itemRegistry.ts
import * as THREE from 'three';
import { createHammer } from './createHammer.js';
import { createCrowbar } from './createCrowbar.js';
import type { HeldItemDef } from './heldItemHandler.js';

export const itemRegistry: Record<string, HeldItemDef> = {
  crowbar: {
    create: () => createCrowbar(),
    position: [0, 0, 0],
    rotation: [Math.PI / 2, 0, 0],
    swingCurves: {
      Sword_Attack: (t) => {
        const arc = Math.sin(Math.PI * t);
        return new THREE.Euler(-arc * 1.8, arc * 0.3, 0);
      },
    },
  },

  // Example of a different item reacting to a different clip, to show
  // the generalization doing real work: no swing on Sword_Attack, a
  // recoil kick on Pistol_Shoot instead.
  pistol: {
    create: () => createHammer(), // placeholder until you have createPistol()
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    swingCurves: {
      Pistol_Shoot: (t) => {
        const kick = Math.sin(Math.PI * Math.min(t * 3, 1)) * (1 - t); // fast snap, slow settle
        return new THREE.Euler(-kick * 0.25, 0, 0);
      },
    },
  },
};
