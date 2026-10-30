import * as THREE from "three";
import { prepareShipSurfaceMesh } from "../scripts/global/shipSurface.js";
import environmentCel from "../shaders/frag/environmentCel.frag.glsl?raw";
import characterInk from "../shaders/vert/characterInk.vert.glsl?raw";
import environmentInkVertex from "../shaders/vert/environmentInk.vert.glsl?raw";
import environmentInkFragment from "../shaders/frag/environmentInk.frag.glsl?raw";

const environmentMaterials = new WeakSet<THREE.Material>();
const comicEnabled = { value: 0 };
const inkEnabled = { value: 0 };
let comicLookEnabled = false;
let outlinesEnabled = false;
let comicFrameEnabled = false;

export function getComicLookEnabled() {
  return comicLookEnabled;
}

export function setComicLookEnabled(enabled: boolean) {
  comicLookEnabled = enabled;
  setComicFrameEnabled(comicFrameEnabled);
}

export function getOutlinesEnabled() {
  return outlinesEnabled;
}

export function setOutlinesEnabled(enabled: boolean) {
  outlinesEnabled = enabled;
  setComicFrameEnabled(comicFrameEnabled);
}

export function setComicFrameEnabled(enabled: boolean, forceOutlines = false) {
  comicFrameEnabled = enabled;
  comicEnabled.value = comicLookEnabled && enabled ? 1 : 0;
  inkEnabled.value = (outlinesEnabled || forceOutlines) && enabled ? 1 : 0;
}

export function withoutComicLook<T>(render: () => T): T {
  const previousComic = comicEnabled.value;
  const previousInk = inkEnabled.value;
  comicEnabled.value = 0;
  inkEnabled.value = 0;
  try {
    return render();
  } finally {
    comicEnabled.value = previousComic;
    inkEnabled.value = previousInk;
  }
}

function shadeEnvironmentMaterial(material: THREE.MeshStandardMaterial) {
  if (environmentMaterials.has(material)) return;
  environmentMaterials.add(material);
  material.customProgramCacheKey = () => "environment-lit-cel-cool-shadow-v2";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uComicEnabled = comicEnabled;
    shader.fragmentShader = `uniform float uComicEnabled;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `${environmentCel}\n#include <opaque_fragment>`,
    );
  };
  material.needsUpdate = true;
}

export function createCabinCelMaterial(source: THREE.MeshStandardMaterial) {
  const material = source.clone();
  shadeEnvironmentMaterial(material);
  return material;
}

export function addCabinInk(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node instanceof THREE.SkinnedMesh ||
        (node instanceof THREE.InstancedMesh && !node.name.includes("WindingStoneTrail")) ||
        preserveAppearance(node)) return;
    // Construction-piece outlines would expose seams across continuous walls
    // and flicker where adjacent lintel/corner edges share the same depth.
    if (node.userData.shipSurfaceContinuous) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (!materials.some((material) =>
      material instanceof THREE.MeshStandardMaterial &&
      environmentMaterials.has(material) && !material.transparent,
    )) return;
    // Avoid dense imported meshes; outline structural edges rather than triangulation.
    if (node.geometry.getAttribute("position").count > 12000) return;
    node.geometry.computeBoundingBox();
    const size = node.geometry.boundingBox!.getSize(new THREE.Vector3())
      .multiply(node.scale);
    if (Math.max(size.x, size.y, size.z) < 0.35) return;
    meshes.push(node);
  });
  for (const mesh of meshes) {
    if (mesh.getObjectByName("CabinComicInk")) continue;
    let edges: THREE.BufferGeometry = new THREE.EdgesGeometry(mesh.geometry, 45);
    if (mesh instanceof THREE.InstancedMesh) {
      const source = edges.getAttribute("position");
      const positions = new Float32Array(source.count * mesh.count * 3);
      const matrix = new THREE.Matrix4();
      const point = new THREE.Vector3();
      for (let instance = 0; instance < mesh.count; instance++) {
        mesh.getMatrixAt(instance, matrix);
        for (let vertex = 0; vertex < source.count; vertex++) {
          point.fromBufferAttribute(source, vertex).applyMatrix4(matrix);
          point.toArray(positions, (instance * source.count + vertex) * 3);
        }
      }
      edges.dispose();
      edges = new THREE.BufferGeometry();
      edges.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    }
    const ink = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    ink.name = "CabinComicInk";
    ink.material.customProgramCacheKey = () => "environment-black-ink-toggle-v2";
    ink.material.onBeforeCompile = (shader) => {
      shader.uniforms.uInkEnabled = inkEnabled;
      shader.fragmentShader = `uniform float uInkEnabled;\n${shader.fragmentShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>", environmentInkVertex,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `${environmentInkFragment}\n#include <opaque_fragment>`,
      );
    };
    ink.userData.minimap = false;
    mesh.add(ink);
    mesh.geometry.addEventListener("dispose", () => {
      ink.geometry.dispose();
      ink.material.dispose();
      ink.removeFromParent();
    });
  }
}

const environmentScenes = new WeakMap<THREE.Scene, {
  pending: Set<THREE.Object3D>;
  tracked: WeakSet<THREE.Object3D>;
}>();

function preserveAppearance(node: THREE.Object3D) {
  for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) {
    if (parent.userData.preserveComicAppearance ||
        parent instanceof THREE.SkinnedMesh ||
        /player|brondon|brendan|student|scavenger|enemy|drone|boss|dino|shark|mech|primeframe|finalverdict|shuttle|escapepod|spaceship|capitalship|mothership|interceptor|fighter|scrambler|projectile|weapon/i.test(parent.name))
      return true;
  }
  return false;
}

/** Track additions rather than scanning the complete world on every frame. */
export function prepareEnvironmentComicShading(scene: THREE.Scene) {
  let state = environmentScenes.get(scene);
  if (!state) {
    state = { pending: new Set([scene]), tracked: new WeakSet() };
    environmentScenes.set(scene, state);
  }
  const { pending, tracked } = state;
  const roots = [...pending];
  pending.clear();
  for (const root of roots) {
    root.traverse((node) => {
      if (!tracked.has(node)) {
        tracked.add(node);
        node.addEventListener("childadded", (event) => pending.add(event.child));
      }
      if (!(node instanceof THREE.Mesh)) return;
      prepareShipSurfaceMesh(node);
      if (preserveAppearance(node)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) ||
            material.transparent || material.opacity < 1 ||
            material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile)
          continue;
        shadeEnvironmentMaterial(material);
      }
    });
    if (!preserveAppearance(root)) addCabinInk(root);
  }
}

export function addCharacterInk(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.every((material) => !material.visible || material.transparent)) return;
    if (/eye|glasses|lens/i.test(node.name)) return;
    meshes.push(node);
  });
  for (const mesh of meshes) {
    const material = new THREE.MeshBasicMaterial({
      name: "BrondonSilhouetteOutline",
      color: 0x000000,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    const viewport = new THREE.Vector2();
    material.customProgramCacheKey = () => "brondon-black-ink-toggle-v2";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uInkEnabled = inkEnabled;
      shader.uniforms.uInkViewport = { value: viewport };
      shader.fragmentShader = `uniform float uInkEnabled;\n${shader.fragmentShader}`
        .replace("#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nif (uInkEnabled < 0.5) discard;");
      shader.vertexShader = `uniform vec2 uInkViewport;\n${shader.vertexShader}`
        .replace("#include <project_vertex>", characterInk);
    };
    const ink = mesh instanceof THREE.SkinnedMesh
      ? new THREE.SkinnedMesh(mesh.geometry, material)
      : new THREE.Mesh(mesh.geometry, material);
    if (ink instanceof THREE.SkinnedMesh && mesh instanceof THREE.SkinnedMesh) {
      ink.bindMode = mesh.bindMode;
      ink.bind(mesh.skeleton, mesh.bindMatrix);
    }
    ink.name = "BrondonComicInk";
    ink.frustumCulled = false;
    ink.userData.minimap = false;
    ink.onBeforeRender = (renderer) => {
      renderer.getSize(viewport);
    };
    mesh.add(ink);
  }
}
