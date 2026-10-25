import * as THREE from "three";

type LightKind =
  | "directional"
  | "directionalShadow"
  | "point"
  | "pointShadow"
  | "spot"
  | "spotShadow"
  | "hemisphere";

const KINDS: LightKind[] = [
  "directional",
  "directionalShadow",
  "point",
  "pointShadow",
  "spot",
  "spotShadow",
  "hemisphere",
];

function kindOf(light: THREE.Light): LightKind | null {
  if (light instanceof THREE.DirectionalLight)
    return light.castShadow ? "directionalShadow" : "directional";
  if (light instanceof THREE.PointLight)
    return light.castShadow ? "pointShadow" : "point";
  if (light instanceof THREE.SpotLight)
    return light.map ? null : light.castShadow ? "spotShadow" : "spot";
  if (light instanceof THREE.HemisphereLight) return "hemisphere";
  return null;
}

function createDummy(kind: LightKind) {
  const light =
    kind === "directional" || kind === "directionalShadow"
      ? new THREE.DirectionalLight(0x000000, 0)
      : kind === "point" || kind === "pointShadow"
        ? new THREE.PointLight(0x000000, 0, 0.001)
        : kind === "spot" || kind === "spotShadow"
          ? new THREE.SpotLight(0x000000, 0, 0.001)
          : new THREE.HemisphereLight(0x000000, 0x000000, 0);
  if (kind.endsWith("Shadow")) {
    light.castShadow = true;
    const shadow = (light as THREE.DirectionalLight).shadow;
    shadow.mapSize.set(1, 1);
    shadow.autoUpdate = false;
    shadow.needsUpdate = true;
  }
  light.name = `LightCountPlaceholder:${kind}`;
  return light;
}

function effectivelyVisible(node: THREE.Object3D) {
  for (let current: THREE.Object3D | null = node; current; current = current.parent)
    if (!current.visible) return false;
  return true;
}

/**
 * Three.js keys every lit shader on the number of active lights per type, so
 * hiding or showing a light (or a group holding one) recompiles every lit
 * material and stalls the frame. This pads hidden lights with zero-intensity
 * placeholders of the same type so the light layout never changes mid-scene.
 */
export function createLightCountStabilizer(scene: THREE.Scene) {
  const holder = new THREE.Group();
  holder.name = "LightCountStabilizer";
  scene.add(holder);
  const pools = new Map<LightKind, THREE.Light[]>(KINDS.map((k) => [k, []]));
  const target = new Map<LightKind, number>(KINDS.map((k) => [k, 0]));
  const active = new Map<LightKind, number>();
  let lights: THREE.Light[] = [];
  let framesUntilRefresh = 0;

  function refresh() {
    const totals = new Map<LightKind, number>(KINDS.map((k) => [k, 0]));
    lights = [];
    scene.traverse((node) => {
      if (node === holder || !(node instanceof THREE.Light)) return;
      if (node.parent === holder) return;
      const kind = kindOf(node);
      if (!kind) return;
      lights.push(node);
      totals.set(kind, totals.get(kind)! + 1);
    });
    for (const kind of KINDS)
      target.set(kind, Math.max(target.get(kind)!, totals.get(kind)!));
    framesUntilRefresh = 30;
  }

  function sync() {
    if (framesUntilRefresh-- <= 0) refresh();
    for (const kind of KINDS) active.set(kind, 0);
    for (const light of lights) {
      if (!light.parent || !effectivelyVisible(light)) continue;
      const kind = kindOf(light);
      if (kind) active.set(kind, active.get(kind)! + 1);
    }
    for (const kind of KINDS) {
      const pool = pools.get(kind)!;
      const needed = Math.max(0, target.get(kind)! - active.get(kind)!);
      while (pool.length < needed) {
        const dummy = createDummy(kind);
        pool.push(dummy);
        holder.add(dummy);
      }
      pool.forEach((dummy, index) => (dummy.visible = index < needed));
    }
  }

  return {
    sync,
    refresh() {
      framesUntilRefresh = 0;
    },
    dispose() {
      holder.removeFromParent();
      for (const pool of pools.values())
        for (const light of pool) {
          (light as THREE.DirectionalLight).shadow?.dispose();
          light.dispose();
        }
    },
  };
}
