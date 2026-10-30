import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  loadPlayableCharacterModel, PLAYABLE_CHARACTERS, PLAYABLE_CHARACTER_NAMES,
  loadFinaleMechModel, loadGundamModel, loadEarthModel,
  type PlayableCharacter,
} from "../../core/loader.js";
import { disposeRoom } from "../../scripts/global/shipRoom.js";

type DisplayAsset = { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] };
const FILES: Record<PlayableCharacter, string> = {
  brondon: "Don.glb", brendan: "DonfromStreets.glb", branden: "branden-the-dripless-export.glb",
  caleb: "Caleb.glb", husain: "Husain.glb", andre: "Andre.glb", sibusiso: "Sibusiso.glb", sohrab: "Sohrab.glb",
};
const MODELS: Array<{ id: string; label: string; load: () => Promise<DisplayAsset> }> = [
  ...PLAYABLE_CHARACTERS.map((id) => ({ id, label: `${PLAYABLE_CHARACTER_NAMES[id]} / ${FILES[id]}`, load: () => loadPlayableCharacterModel(id) })),
  { id: "finale-mech", label: "Finale mech / mechs.glb", load: loadFinaleMechModel },
  { id: "gundam", label: "RX-78-2 Gundam / special reference", load: loadGundamModel },
  { id: "earth", label: "Earth / textured planet", load: loadEarthModel },
];
const BACKDROPS = [
  { label: "Midnight", color: 0x101827 },
  { label: "Black", color: 0x000000 },
  { label: "White", color: 0xffffff },
  { label: "Grey", color: 0x808080 },
  { label: "Blue", color: 0x3566b8 },
  { label: "Green", color: 0x398254 },
  { label: "Red", color: 0xa83342 },
  { label: "Purple", color: 0x7042a3 },
  { label: "Orange", color: 0xdb873c },
];
function disposeActor(root: THREE.Object3D) {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((node) => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton); });
  skeletons.forEach((skeleton) => skeleton.dispose());
  disposeRoom(root);
  root.removeFromParent();
}

/** A lazy, scene-independent studio: never animates or disposes the live player. */
export function createMuseumPhotoStudio(character: PlayableCharacter, onClose: () => void) {
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 1024;
  screenCanvas.height = 576;
  const screenContext = screenCanvas.getContext("2d")!;
  screenContext.fillStyle = "#f7fbff";
  screenContext.fillRect(0, 0, 1024, 576);
  screenContext.strokeStyle = "#17191f";
  screenContext.lineWidth = 8;
  screenContext.strokeRect(25, 25, 974, 526);
  screenContext.fillStyle = "#43c9eb";
  screenContext.fillRect(40, 150, 944, 120);
  screenContext.fillStyle = "#17191f";
  screenContext.textAlign = "center";
  screenContext.font = "700 58px sans-serif";
  screenContext.fillText("CHARACTER STUDIO", 512, 235);
  screenContext.font = "30px sans-serif";
  screenContext.fillText("MODELS / POSES / COLOURS", 512, 320);
  screenContext.fillText("INTERACT TO CREATE A PORTRAIT", 512, 415);
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  const dialog = document.createElement("dialog");
  dialog.className = "museum-photo-studio";
  dialog.setAttribute("aria-labelledby", "museum-studio-heading");
  dialog.innerHTML = `<header><div><small>BRONDON'S MUSEUM / CAST ARCHIVE</small><h1 id="museum-studio-heading">Character Studio</h1></div><button type="button" data-close>BACK TO MUSEUM</button></header>
    <div class="museum-studio-layout"><section class="museum-studio-stage" aria-label="Model preview"><div class="museum-studio-canvas"></div><p>Drag to orbit · scroll or pinch to zoom · right-drag to pan</p><p class="museum-studio-credit" data-model-credit>Model by Husain Battey</p></section>
    <section class="museum-studio-settings" aria-label="Photo settings">
      <label>MODEL / ASSET<select data-model></select></label>
      <div class="museum-studio-row"><button type="button" data-prev>PREVIOUS MODEL</button><button type="button" data-next>NEXT MODEL</button></div>
      <label>RIG POSE / ANIMATION<select data-pose><option value="">Rest pose</option></select></label>
      <label>POSE FRAME<input data-time type="range" min="0" max="100" value="35"><output data-frame>35%</output></label>
      <button type="button" data-play aria-pressed="false">PLAY ANIMATION</button>
      <label>MODEL ROTATION<input data-rotation type="range" min="0" max="360" value="0"></label>
      <div class="museum-studio-row"><button type="button" data-left>ROTATE LEFT</button><button type="button" data-right>ROTATE RIGHT</button></div>
      <div class="museum-studio-row"><button type="button" data-in>ZOOM IN</button><button type="button" data-out>ZOOM OUT</button><button type="button" data-reset>RESET VIEW</button></div>
      <label>BACKGROUND COLOUR<select data-background></select></label>
      <button type="button" data-download>DOWNLOAD PNG / 1920 × 1080</button>
      <p class="museum-studio-note">Poses come from the selected model's own rig clips, when available. The photo includes the model and backdrop, without the controls.</p>
      <p role="status" data-status></p>
    </section></div>`;
  dialog.querySelectorAll("button").forEach((button) => button.classList.add("menu-btn"));
  document.body.append(dialog);
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const modelSelect = get<HTMLSelectElement>("[data-model]");
  const poseSelect = get<HTMLSelectElement>("[data-pose]");
  const backdropSelect = get<HTMLSelectElement>("[data-background]");
  const poseTime = get<HTMLInputElement>("[data-time]");
  const rotation = get<HTMLInputElement>("[data-rotation]");
  const status = get("[data-status]");
  const captureButton = get<HTMLButtonElement>("[data-download]");
  const canvasHost = get(".museum-studio-canvas");
  MODELS.forEach((model) => modelSelect.add(new Option(model.label, model.id)));
  modelSelect.value = character;
  BACKDROPS.forEach((backdrop, i) => backdropSelect.add(new Option(backdrop.label, String(i))));
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null, camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null, environment: THREE.WebGLRenderTarget | null = null;
  let turntable: THREE.Group | null = null, fill: THREE.DirectionalLight | null = null;
  let asset: DisplayAsset | null = null, mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  let raf = 0, lastTime = 0, modelVersion = 0;
  let disposed = false, paused = false, playing = false, modelLoading = false, exporting = false;
  const events = new AbortController(), downloads = new Set<string>();
  let resize: ResizeObserver | null = null;
  function buttons() {
    captureButton.disabled = !asset || modelLoading || exporting;
    poseSelect.disabled = modelLoading || !asset?.animations.length;
    poseTime.disabled = modelLoading || !action;
    get<HTMLButtonElement>("[data-play]").disabled = modelLoading || !action;
  }
  function stopAnimation() {
    playing = false;
    get("[data-play]").textContent = "PLAY ANIMATION";
    get("[data-play]").setAttribute("aria-pressed", "false");
  }
  function releaseActor() {
    mixer?.stopAllAction();
    if (asset) {
      mixer?.uncacheRoot(asset.scene);
      disposeActor(asset.scene);
    }
    asset = null; mixer = null; action = null;
  }
  function bounds() {
    if (!asset) return new THREE.Box3();
    asset.scene.updateWorldMatrix(true, true);
    asset.scene.traverse((node) => { if (node instanceof THREE.SkinnedMesh) node.skeleton.update(); });
    return new THREE.Box3().setFromObject(asset.scene, true);
  }
  function frameModel() {
    if (!asset || !camera || !controls) return;
    const box = bounds(), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const distance = Math.max(size.y, size.x / camera.aspect, 0.5) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35 + size.z / 2;
    camera.position.copy(center).add(new THREE.Vector3(0, size.y * 0.04, distance));
    controls.target.copy(center);
    controls.minDistance = Math.max(0.15, distance * 0.15);
    controls.maxDistance = Math.max(8, distance * 4);
    controls.update();
  }
  function samplePose() {
    if (!mixer) return;
    mixer.stopAllAction();
    action = null;
    if (poseSelect.value && asset) {
      const clip = asset.animations.find((clip) => clip.name === poseSelect.value);
      if (clip) {
        action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play();
        action.clampWhenFinished = true;
        action.paused = true;
        action.time = clip.duration * Number(poseTime.value) / 100;
        mixer.update(0);
      }
    }
    get("[data-frame]").textContent = `${poseTime.value}%`;
    buttons();
  }
  async function selectModel() {
    const entry = MODELS.find((model) => model.id === modelSelect.value)!;
    const version = ++modelVersion;
    modelLoading = true;
    stopAnimation();
    buttons();
    status.textContent = `Loading ${entry.label}...`;
    const credit = get("[data-model-credit]");
    if (entry.id === "gundam") {
      credit.innerHTML = `Special reference: <a href="https://sketchfab.com/3d-models/rx-78-2-gundam-8b1ec0f948984aa897e60b63a13b501c" target="_blank" rel="noreferrer">RX-78-2 Gundam</a> by <a href="https://sketchfab.com/nama_140" target="_blank" rel="noreferrer">みそ太郎</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Rescaled for display; not a CHASS model.`;
    } else if (entry.id === "earth") {
      credit.textContent = "Earth texture contribution: André";
    } else credit.textContent = "Model by Husain Battey";
    try {
      const next = await entry.load();
      if (disposed || !dialog.open || version !== modelVersion || !turntable) { disposeActor(next.scene); return; }
      releaseActor();
      asset = next;
      const model = next.scene;
      model.traverse((node) => {
        if (node instanceof THREE.Mesh) { node.frustumCulled = false; node.castShadow = false; }
      });
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true);
      const size = box.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(2.4 / Math.max(size.x, size.y, size.z, 0.01));
      box.setFromObject(model, true);
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.y -= box.min.y;
      model.position.z -= center.z;
      turntable.rotation.y = 0;
      rotation.value = "0";
      turntable.add(model);
      mixer = new THREE.AnimationMixer(model);
      const unique = [...new Map(next.animations.filter((clip) => clip.duration > 0).map((clip) => [clip.name, clip])).values()];
      const signature = /idle|victory|dance|wave|taunt|sword|pose|salute/i;
      unique.sort((a, b) => Number(signature.test(b.name)) - Number(signature.test(a.name)) || a.name.localeCompare(b.name));
      poseSelect.replaceChildren(new Option("Rest pose / bind pose", ""), ...unique.map((clip) => new Option(clip.name.replace(/_/g, " "), clip.name)));
      poseSelect.value = unique.find((clip) => /idle/i.test(clip.name))?.name ?? unique[0]?.name ?? "";
      poseTime.value = "35";
      modelLoading = false;
      samplePose();
      frameModel();
      status.textContent = unique.length ? `${unique.length} authored rig clips available. Choose a pose and scrub its frame.` : "This model has no animation clips. Orbit, rotate or zoom to frame your photo.";
    } catch (error) {
      if (version === modelVersion && dialog.open) {
        releaseActor();
        poseSelect.replaceChildren(new Option("Model unavailable", ""));
        status.textContent = `Model unavailable: ${error instanceof Error ? error.message : String(error)}. Choose another model or retry with Previous / Next.`;
        modelLoading = false;
      }
    } finally { if (version === modelVersion) buttons(); }
  }
  function selectBackdrop() {
    const entry = BACKDROPS[Number(backdropSelect.value)];
    if (!scene) return;
    scene.background = new THREE.Color(entry.color);
  }
  function resizeView() {
    if (!renderer || !camera || exporting) return;
    const width = Math.max(1, canvasHost.clientWidth), height = Math.max(1, canvasHost.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  function render(time: number) {
    if (!renderer || !scene || !camera || !dialog.open) return;
    raf = requestAnimationFrame(render);
    const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    if (paused || document.hidden) return;
    if (playing && action && mixer) {
      action.time = (action.time + dt) % action.getClip().duration;
      action.paused = true;
      mixer.update(0);
      poseTime.value = String(action.time / action.getClip().duration * 100);
      get("[data-frame]").textContent = `${Math.round(Number(poseTime.value))}%`;
    }
    controls?.update();
    renderer.render(scene, camera);
  }
  function updateKiosk() {
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    screenContext.drawImage(renderer.domElement, 0, 0, 1024, 576);
    screenTexture.needsUpdate = true;
  }
  function rotate(degrees: number) {
    if (!turntable) return;
    rotation.value = String((Number(rotation.value) + degrees + 360) % 360);
    turntable.rotation.y = THREE.MathUtils.degToRad(Number(rotation.value));
  }
  function zoom(factor: number) {
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
  function capture() {
    if (!renderer || !scene || !camera || captureButton.disabled) return;
    const view = renderer, shotScene = scene, shotCamera = camera;
    const size = view.getSize(new THREE.Vector2()), pixelRatio = view.getPixelRatio(), aspect = shotCamera.aspect;
    const filename = `brondons-revenge-${modelSelect.value}-${poseSelect.value || "rest"}-${BACKDROPS[Number(backdropSelect.value)].label}`.replace(/[^a-z0-9-]+/gi, "-");
    exporting = true;
    buttons();
    try {
      view.setPixelRatio(1);
      view.setSize(1920, 1080, false);
      shotCamera.aspect = 16 / 9;
      shotCamera.updateProjectionMatrix();
      view.render(shotScene, shotCamera);
      screenContext.drawImage(view.domElement, 0, 0, 1024, 576);
      screenTexture.needsUpdate = true;
      view.domElement.toBlob((blob) => {
        if (!blob || disposed) {
          if (!disposed) status.textContent = "The browser could not create the picture. Please retry.";
          exporting = false; buttons(); return;
        }
        const url = URL.createObjectURL(blob);
        downloads.add(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filename}.png`;
        document.body.append(link);
        link.click(); link.remove();
        setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
        status.textContent = "PNG downloaded / 1920 × 1080";
        exporting = false; buttons();
      }, "image/png");
    } catch (error) {
      status.textContent = `Could not save picture: ${error instanceof Error ? error.message : String(error)}`;
      exporting = false; buttons();
    } finally {
      view.setPixelRatio(pixelRatio); view.setSize(size.x, size.y, false);
      shotCamera.aspect = aspect; shotCamera.updateProjectionMatrix();
    }
  }
  function releaseView() {
    modelVersion++;
    cancelAnimationFrame(raf); raf = 0;
    resize?.disconnect(); resize = null;
    controls?.dispose(); controls = null;
    releaseActor();
    environment?.dispose(); environment = null;
    renderer?.dispose(); renderer?.domElement.remove(); renderer = null;
    scene = null; camera = null; turntable = null; fill = null;
    modelLoading = false;
    stopAnimation();
  }
  function close() {
    if (!dialog.open) return;
    try { updateKiosk(); } finally {
      dialog.close();
      releaseView();
      document.body.classList.remove("museum-studio-open");
      onClose();
    }
  }
  get("[data-close]").onclick = close;
  modelSelect.onchange = () => { void selectModel(); };
  for (const [selector, step] of [["[data-prev]", -1], ["[data-next]", 1]] as const)
    get(selector).onclick = () => { modelSelect.selectedIndex = (modelSelect.selectedIndex + step + MODELS.length) % MODELS.length; void selectModel(); };
  backdropSelect.onchange = selectBackdrop;
  poseSelect.onchange = () => { stopAnimation(); samplePose(); frameModel(); };
  poseTime.oninput = () => { stopAnimation(); samplePose(); };
  rotation.oninput = () => { if (turntable) turntable.rotation.y = THREE.MathUtils.degToRad(Number(rotation.value)); };
  get("[data-left]").onclick = () => rotate(-15);
  get("[data-right]").onclick = () => rotate(15);
  get("[data-in]").onclick = () => zoom(0.85);
  get("[data-out]").onclick = () => zoom(1.15);
  get("[data-reset]").onclick = frameModel;
  get("[data-play]").onclick = () => {
    if (!action) return;
    playing = !playing;
    get("[data-play]").textContent = playing ? "FREEZE POSE" : "PLAY ANIMATION";
    get("[data-play]").setAttribute("aria-pressed", String(playing));
  };
  captureButton.onclick = capture;
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); }, { signal: events.signal });
  dialog.addEventListener("keydown", (event) => { event.stopPropagation(); }, { signal: events.signal });
  return {
    screenTexture,
    get element() { return dialog; },
    get isOpen() { return dialog.open; },
    open() {
      if (disposed || dialog.open) return;
      paused = false;
      dialog.showModal();
      document.body.classList.add("museum-studio-open");
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        canvasHost.append(renderer.domElement);
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x101827);
        camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.01, 100);
        turntable = new THREE.Group(); scene.add(turntable);
        scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x394053, 2));
        const key = new THREE.DirectionalLight(0xffead4, 2.8); key.position.set(3, 5, 4); scene.add(key);
        fill = new THREE.DirectionalLight(0xa6cfff, 1.5); fill.position.set(-3, 2, -1); scene.add(fill);
        const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
        environment = pmrem.fromScene(room, 0.04); pmrem.dispose(); room.dispose();
        scene.environment = environment.texture;
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = false;
        controls.minPolarAngle = 0.15;
        controls.maxPolarAngle = Math.PI * 0.87;
        resize = new ResizeObserver(resizeView); resize.observe(canvasHost);
        resizeView();
        void selectModel(); selectBackdrop();
        lastTime = performance.now(); raf = requestAnimationFrame(render);
      } catch (error) {
        releaseView();
        status.textContent = `The photo renderer could not open: ${error instanceof Error ? error.message : String(error)}. Close and reopen to retry.`;
        buttons();
      }
      modelSelect.focus();
    },
    close,
    setPaused(value: boolean) { paused = value; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (dialog.open) dialog.close();
      releaseView(); events.abort(); dialog.remove(); screenTexture.dispose();
      downloads.forEach((url) => URL.revokeObjectURL(url)); downloads.clear();
      document.body.classList.remove("museum-studio-open");
    },
  };
}
