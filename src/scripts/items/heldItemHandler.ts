// items/heldItemHandler.ts
import * as THREE from 'three';

export interface SwingCurve {
  // Extra rotation applied on top of the grip rotation, as a function of
  // normalized clip progress t in [0, 1].
  (t: number): THREE.Euler;
}

// Maps an animation clip name (e.g. 'Sword_Attack', 'Pistol_Shoot') to the
// swing/kick curve this item should play while that clip is active.
// Clips not present here simply don't move the item.
export type SwingCurveMap = Partial<Record<string, SwingCurve>>;

export interface HeldItemDef {
  create: () => THREE.Group;
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: number;
  swingCurves?: SwingCurveMap;
}

export function createHeldItemHandler(attachPoint: THREE.Object3D) {
  const pivot = new THREE.Group();
  attachPoint.add(pivot);

  let currentItem: THREE.Group | null = null;
  let currentName: string | null = null;
  let baseRotation = new THREE.Euler();
  let swingCurves: SwingCurveMap = {};

  function equip(name: string, def: HeldItemDef) {
    unequip();
    const item = def.create();
    item.position.set(0, 0, 0);
    item.scale.setScalar(def.scale ?? 1);

    pivot.position.set(...def.position);
    baseRotation = new THREE.Euler(...def.rotation);
    pivot.rotation.copy(baseRotation);

    pivot.add(item);
    currentItem = item;
    currentName = name;
    swingCurves = def.swingCurves ?? {};
  }

  function unequip() {
    if (currentItem) {
      currentItem.removeFromParent();
      currentItem = null;
      currentName = null;
      swingCurves = {};
    }
  }

  // Call every frame with the currently-playing clip name and its
  // normalized progress [0,1], or (null, null) when no action clip is
  // active. If the equipped item has no curve for that clip, it just
  // holds its base grip pose — no branching needed at the call site.
  function updateSwing(clipName: string | null, t: number | null) {
    if (!currentItem) return;
    const curve = clipName ? swingCurves[clipName] : undefined;
    if (!curve || t === null) {
      pivot.rotation.copy(baseRotation);
      return;
    }
    const extra = curve(t);
    pivot.rotation.set(
      baseRotation.x + extra.x,
      baseRotation.y + extra.y,
      baseRotation.z + extra.z,
    );
  }

  function dispose() {
    unequip();
    pivot.removeFromParent();
  }

  return {
    equip,
    unequip,
    updateSwing,
    dispose,
    getCurrentName: () => currentName,
    isHolding: (name?: string) => (name ? currentName === name : currentItem !== null),
  };
}

export type HeldItemHandler = ReturnType<typeof createHeldItemHandler>;
