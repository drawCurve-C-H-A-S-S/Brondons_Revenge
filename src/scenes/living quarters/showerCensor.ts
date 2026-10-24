import * as THREE from "three";

/** While showering, the character turns skin coloured and a blur patch covers the body on screen. */
export function createShowerCensor(parent: HTMLElement, camera: THREE.Camera) {
  const overlay = document.createElement("div");
  overlay.id = "shower-censor";
  Object.assign(overlay.style, {
    position: "fixed",
    display: "none",
    pointerEvents: "none",
    borderRadius: "40%",
    zIndex: "5",
    backdropFilter: "blur(18px)",
    webkitBackdropFilter: "blur(18px)",
  });
  parent.append(overlay);
  const skin = new THREE.MeshStandardMaterial({
    color: 0xe0ac8a,
    roughness: 0.7,
  });
  const original = new Map<
    THREE.SkinnedMesh,
    THREE.Material | THREE.Material[]
  >();
  const bounds = new THREE.Box3(),
    corner = new THREE.Vector3();

  function restore() {
    for (const [mesh, material] of original) mesh.material = material;
    original.clear();
    overlay.style.display = "none";
  }
  function update(model: THREE.Object3D | null, active: boolean) {
    if (!model || !model.visible || !active) {
      restore();
      return;
    }
    if (!original.size)
      model.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) {
          original.set(node, node.material);
          node.material = skin;
        }
      });
    model.updateWorldMatrix(true, true);
    camera.updateMatrixWorld();
    bounds.setFromObject(model);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      visible = false;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          corner.set(x, y, z).project(camera as THREE.PerspectiveCamera);
          if (corner.z < 1) visible = true;
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        }
    if (!visible) {
      overlay.style.display = "none";
      return;
    }
    const w = window.innerWidth,
      h = window.innerHeight,
      pad = 12;
    overlay.style.display = "block";
    overlay.style.left = `${((minX + 1) / 2) * w - pad}px`;
    overlay.style.top = `${((1 - maxY) / 2) * h - pad}px`;
    overlay.style.width = `${((maxX - minX) / 2) * w + pad * 2}px`;
    overlay.style.height = `${((maxY - minY) / 2) * h + pad * 2}px`;
  }
  return {
    update,
    dispose() {
      restore();
      overlay.remove();
      skin.dispose();
    },
  };
}
