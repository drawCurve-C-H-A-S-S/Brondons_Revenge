import * as THREE from "three";
import {
  CSS3DObject,
  CSS3DRenderer,
} from "three/addons/renderers/CSS3DRenderer.js";

export const FACILITY_WEBSITE_URL = "https://fla.capitalsigma.biz/";

export function createFacilityBrowser(
  onOpen: () => void,
  onClose: () => void,
  {
    url = FACILITY_WEBSITE_URL,
    title = "FLA facility screen",
    muted = false,
  }: { url?: string; title?: string; muted?: boolean } = {},
) {
  // Alpha cutouts let the real DOM pages share the WebGL scene's depth occlusion.
  const material = new THREE.MeshBasicMaterial({
    color: 0,
    opacity: 0,
    blending: THREE.NoBlending,
    fog: false,
    toneMapped: false,
  });
  const world = new THREE.Scene(),
    renderer = new CSS3DRenderer();
  renderer.domElement.className = "facility-web-world";
  renderer.domElement.style.display = "none";
  document.body.appendChild(renderer.domElement);
  const screens: Array<{
    mesh: THREE.Mesh;
    object: CSS3DObject;
    frame: HTMLIFrameElement;
    width: number;
    height: number;
    pixelHeight: number;
  }> = [];
  const raycaster = new THREE.Raycaster(),
    center = new THREE.Vector2(),
    eye = new THREE.Vector3();
  const controls = document.createElement("div");
  controls.className = "facility-web-controls";
  controls.hidden = true;
  const address = document.createElement("span");
  address.textContent = url;
  const external = document.createElement("a");
  external.textContent = "Open in browser";
  external.href = url;
  external.target = "_blank";
  external.rel = "noopener noreferrer";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close screen";
  controls.append(address, external, closeButton);
  document.body.appendChild(controls);
  type Screen = (typeof screens)[number];
  let state: {
    screen: Screen;
    camera: THREE.PerspectiveCamera;
    phase: "opening" | "active" | "closing";
    time: number;
    from: THREE.Vector3;
    rotation: THREE.Quaternion;
    fov: number;
    returnPosition: THREE.Vector3;
    returnRotation: THREE.Quaternion;
    returnFov: number;
  } | null = null;
  let disposed = false,
    canvas: HTMLCanvasElement | null = null;
  let width = 0,
    height = 0;
  function leave() {
    if (!state || state.phase === "closing") return;
    state.phase = "closing";
    state.time = 0;
    state.from.copy(state.camera.position);
    state.rotation.copy(state.camera.quaternion);
    state.fov = state.camera.fov;
    controls.hidden = true;
    if (canvas) canvas.style.pointerEvents = "";
    state.screen.object.element.style.pointerEvents = "none";
  }
  closeButton.addEventListener("click", leave);
  function onKey(event: KeyboardEvent) {
    if (!state) return;
    event.stopImmediatePropagation();
    if (event.code === "Escape" || event.code === "KeyE") {
      event.preventDefault();
      leave();
    }
  }
  window.addEventListener("keydown", onKey, true);
  function applyCamera() {
    if (!state) return;
    const { camera, screen } = state;
    const t = THREE.MathUtils.smootherstep(
      state.time,
      0,
      state.phase === "closing" ? 0.65 : 0.95,
    );
    if (state.phase === "closing") {
      camera.position.lerpVectors(state.from, state.returnPosition, t);
      camera.quaternion.slerpQuaternions(
        state.rotation,
        state.returnRotation,
        t,
      );
      camera.fov = THREE.MathUtils.lerp(state.fov, state.returnFov, t);
    } else {
      screen.mesh.updateWorldMatrix(true, false);
      const position = screen.mesh.getWorldPosition(new THREE.Vector3());
      const rotation = screen.mesh.getWorldQuaternion(new THREE.Quaternion());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
      const tangent = Math.tan(THREE.MathUtils.degToRad(42 / 2));
      const distance =
        1.3 *
        Math.max(
          screen.height / (2 * tangent),
          screen.width / (2 * tangent * camera.aspect),
        );
      const view = new THREE.PerspectiveCamera();
      view.position.copy(position).addScaledVector(normal, distance);
      view.lookAt(position);
      camera.position.lerpVectors(state.from, view.position, t);
      camera.quaternion.slerpQuaternions(state.rotation, view.quaternion, t);
      camera.fov = THREE.MathUtils.lerp(state.fov, 42, t);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  return {
    material,
    get active() {
      return state !== null;
    },
    register(mesh: THREE.Mesh<THREE.PlaneGeometry | THREE.CircleGeometry>) {
      const parameters = mesh.geometry.parameters;
      const width =
        "width" in parameters ? parameters.width : parameters.radius * 2;
      const height =
        "height" in parameters ? parameters.height : parameters.radius * 2;
      const pixelHeight = (1280 * height) / width;
      const element = document.createElement("div");
      element.className = "facility-web-surface";
      element.style.width = "1280px";
      element.style.height = `${pixelHeight}px`;
      element.style.pointerEvents = "none";
      if ("radius" in parameters) element.style.borderRadius = "50%";
      const frame = document.createElement("iframe");
      frame.title = title;
      const source = new URL(url);
      if (muted) {
        source.searchParams.set("muted", "1");
        frame.setAttribute("allow", "autoplay 'none'");
      }
      frame.src = source.href;
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox",
      );
      frame.addEventListener("error", () => {
        if (!disposed)
          console.error("[FacilityBrowser] Live screen failed to load:", url);
      });
      element.appendChild(frame);
      const object = new CSS3DObject(element);
      world.add(object);
      element.style.pointerEvents = "none";
      if (!mesh.name) mesh.name = `FacilityWebScreen-${screens.length + 1}`;
      mesh.userData.website = url;
      screens.push({ mesh, object, frame, width, height, pixelHeight });
    },
    focusedScreen(
      camera: THREE.Camera,
      position: { x: number; y: number; z: number },
    ) {
      if (state || disposed) return null;
      camera.updateWorldMatrix(true, false);
      for (const screen of screens) screen.mesh.updateWorldMatrix(true, false);
      raycaster.setFromCamera(center, camera);
      eye.set(position.x, position.y + 1, position.z);
      return (
        raycaster
          .intersectObjects(
            screens.map((screen) => screen.mesh),
            false,
          )
          .find((hit) => hit.point.distanceTo(eye) < 4)?.object ?? null
      );
    },
    open(mesh: THREE.Object3D, camera: THREE.PerspectiveCamera) {
      if (state || disposed) return;
      const screen = screens.find((screen) => screen.mesh === mesh);
      if (!screen)
        throw new Error("Cannot inspect an unregistered facility screen");
      state = {
        screen,
        camera,
        phase: "opening",
        time: 0,
        from: camera.position.clone(),
        rotation: camera.quaternion.clone(),
        fov: camera.fov,
        returnPosition: camera.position.clone(),
        returnRotation: camera.quaternion.clone(),
        returnFov: camera.fov,
      };
      controls.hidden = false;
      document.body.classList.add("facility-browser-open");
      onOpen();
      if (document.pointerLockElement) document.exitPointerLock();
      closeButton.focus();
    },
    update(dt: number) {
      if (!state) return;
      state.time += dt;
      applyCamera();
      if (state.phase === "opening" && state.time >= 0.95) {
        state.phase = "active";
        state.screen.object.element.style.pointerEvents = "auto";
        if (canvas) canvas.style.pointerEvents = "none";
      } else if (state.phase === "closing" && state.time >= 0.65) {
        state = null;
        document.body.classList.remove("facility-browser-open");
        onClose();
      }
    },
    applyCamera,
    render(webgl: THREE.WebGLRenderer, camera: THREE.Camera) {
      if (disposed) return;
      canvas = webgl.domElement;
      renderer.domElement.style.display = "";
      if (width !== window.innerWidth || height !== window.innerHeight) {
        width = window.innerWidth;
        height = window.innerHeight;
        renderer.setSize(width, height);
      }
      const scale = new THREE.Vector3();
      for (const screen of screens) {
        screen.object.visible = true;
        for (
          let node: THREE.Object3D | null = screen.mesh;
          node;
          node = node.parent
        )
          if (!node.visible) {
            screen.object.visible = false;
            break;
          }
        screen.mesh.updateWorldMatrix(true, false);
        screen.mesh.matrixWorld.decompose(
          screen.object.position,
          screen.object.quaternion,
          scale,
        );
        screen.object.scale.set(
          (screen.width * scale.x) / 1280,
          (screen.height * scale.y) / screen.pixelHeight,
          1,
        );
      }
      renderer.render(world, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      state = null;
      if (canvas) canvas.style.pointerEvents = "";
      document.body.classList.remove("facility-browser-open");
      window.removeEventListener("keydown", onKey, true);
      for (const screen of screens) {
        screen.frame.src = "about:blank";
        screen.object.removeFromParent();
      }
      renderer.domElement.remove();
      controls.remove();
    },
  };
}
