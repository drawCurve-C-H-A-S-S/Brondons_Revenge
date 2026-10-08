import * as THREE from 'three';
import { createPointingHand, type PointingHand } from '../../scripts/pointingHand.js';
import type { InteractiveDisplay, SurfaceAction } from './surfaces.js';

export interface InspectionTarget {
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  display: InteractiveDisplay;
  width: number;
  height: number;
  title: string;
  pointer: 'arrow' | 'hand';
  instructions?: string;
  onAction: (action: SurfaceAction) => void;
}
interface InspectionState {
  target: InspectionTarget;
  phase: 'opening' | 'active' | 'closing';
  time: number;
  pressTime: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  fov: number;
  returnPosition: THREE.Vector3;
  returnRotation: THREE.Quaternion;
  returnFov: number;
}

export function createInspectionView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, ui: HTMLElement, onClose: () => void) {
  const controls = document.createElement('div'); controls.id = 'quarters-console-controls'; controls.className = 'hidden';
  const instructions = document.createElement('span'); instructions.setAttribute('role', 'status');
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'E / Esc - Step back';
  controls.append(instructions, close); ui.append(controls);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const view = new THREE.PerspectiveCamera(), center = new THREE.Vector3(), normal = new THREE.Vector3(), up = new THREE.Vector3();
  const cornerA = new THREE.Vector3(), cornerB = new THREE.Vector3();
  let state: InspectionState | null = null, hand: PointingHand | null = null, disposed = false;
  let handLoading: Promise<void> | null = null, handError: Error | null = null;

  function prepareHand() {
    if (hand || handLoading) return;
    handError = null;
    handLoading = createPointingHand().then(loaded => {
      if (disposed) { loaded.dispose(); return; }
      hand = loaded; scene.add(loaded.root);
    }, error => {
      if (disposed) return;
      console.error('[LivingQuarters] Unable to prepare keypad hand:', error);
      handError = error instanceof Error ? error : new Error(String(error));
    }).finally(() => { handLoading = null; });
  }
  function ready() { return state?.target.pointer !== 'hand' || hand !== null; }
  function updateInstructions() {
    if (!state) return;
    instructions.textContent = state.target.pointer === 'hand' && !hand
      ? handError ? 'Unable to load hand. R to retry / E or Esc to step back.' : 'Preparing the Interact hand pose...'
      : state.target.pointer === 'hand' ? 'Click digits or type the code / Enter: OK / Backspace: erase'
        : state.target.instructions ?? 'Click save us to read / Enter: open file';
  }
  function applyCamera() {
    if (!state) return;
    const target = state.target, t = THREE.MathUtils.smootherstep(state.time, 0, state.phase === 'closing' ? 0.65 : 0.95);
    if (state.phase === 'closing') {
      camera.position.lerpVectors(state.position, state.returnPosition, t);
      camera.quaternion.slerpQuaternions(state.rotation, state.returnRotation, t);
      camera.fov = THREE.MathUtils.lerp(state.fov, state.returnFov, t);
    } else {
      target.screen.updateWorldMatrix(true, false);
      const rotation = target.screen.getWorldQuaternion(new THREE.Quaternion());
      target.screen.getWorldPosition(center);
      normal.set(0, 0, 1).applyQuaternion(rotation); up.set(0, 1, 0).applyQuaternion(rotation);
      const fov = 42, tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const distance = 1.55 * Math.max(target.height / (2 * tangent), target.width / (2 * tangent * camera.aspect));
      view.position.copy(center).addScaledVector(normal, distance);
      view.lookAt(center.clone().addScaledVector(up, -target.height * 0.17));
      camera.position.lerpVectors(state.position, view.position, t);
      camera.quaternion.slerpQuaternions(state.rotation, view.quaternion, t);
      camera.fov = THREE.MathUtils.lerp(state.fov, fov, t);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    if (hand) {
      hand.root.visible = state.phase === 'active' && target.pointer === 'hand';
      if (hand.root.visible) {
        const cursor = target.display.cursor, canvas = target.display.canvas;
        const press = state.pressTime > 0 ? Math.sin((1 - state.pressTime / 0.18) * Math.PI) * 0.027 : 0;
        hand.root.position.set((cursor.x / canvas.width - 0.5) * target.width,
          (0.5 - cursor.y / canvas.height) * target.height, 0.045 - press);
        target.screen.localToWorld(hand.root.position);
        target.screen.getWorldQuaternion(hand.root.quaternion);
      }
    }
  }
  function leave() {
    if (!state || state.phase === 'closing') return;
    state.phase = 'closing'; state.time = 0; state.position.copy(camera.position); state.rotation.copy(camera.quaternion); state.fov = camera.fov;
    state.target.display.focus(false); controls.classList.add('hidden');
    if (hand) hand.root.visible = false;
  }
  close.addEventListener('click', leave);
  function canInput() {
    return !disposed && state?.phase === 'active' && ready() && !document.hidden && !document.body.classList.contains('quick-menu-open');
  }
  function pointAt(event: MouseEvent | PointerEvent) {
    if (!state) return false;
    const target = state.target, display = target.display;
    if (document.pointerLockElement) {
      cornerA.set(-target.width / 2, -target.height / 2, 0); target.screen.localToWorld(cornerA); cornerA.project(camera);
      cornerB.set(target.width / 2, target.height / 2, 0); target.screen.localToWorld(cornerB); cornerB.project(camera);
      display.point(display.cursor.x + event.movementX * display.canvas.width / Math.max(1, Math.abs(cornerB.x - cornerA.x) * window.innerWidth / 2),
        display.cursor.y + event.movementY * display.canvas.height / Math.max(1, Math.abs(cornerB.y - cornerA.y) * window.innerHeight / 2));
      return true;
    }
    pointer.set(event.clientX / window.innerWidth * 2 - 1, 1 - event.clientY / window.innerHeight * 2);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(target.screen, false)[0];
    if (!hit?.uv) return false;
    display.point(hit.uv.x * display.canvas.width, (1 - hit.uv.y) * display.canvas.height); return true;
  }
  function onMouseMove(event: MouseEvent) {
    if (!canInput() || controls.contains(event.target instanceof Node ? event.target : null)) return;
    pointAt(event); applyCamera();
  }
  function onPointerDown(event: PointerEvent) {
    if (!canInput() || event.button !== 0 || controls.contains(event.target instanceof Node ? event.target : null)) return;
    if (!document.pointerLockElement && !pointAt(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    state!.pressTime = 0.18;
    const action = state!.target.display.click();
    if (action) state!.target.onAction(action);
    applyCamera();
  }
  function onKey(event: KeyboardEvent) {
    if (!state || disposed || event.repeat || event.defaultPrevented || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'Escape' || event.code === 'KeyE') { event.preventDefault(); event.stopImmediatePropagation(); leave(); return; }
    if (event.code === 'KeyR' && handError && state.target.pointer === 'hand') {
      event.preventDefault(); event.stopImmediatePropagation(); prepareHand(); updateInstructions(); return;
    }
    if (event.target instanceof HTMLElement && controls.contains(event.target)) return;
    if (!canInput() || event.code === 'Tab') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const action = state.target.display.key(event.code);
    if (action) {
      state.pressTime = 0.18;
      if (action !== 'handled') state.target.onAction(action);
    }
    applyCamera();
  }
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKey, true);
  return {
    get active() { return state !== null; },
    open(target: InspectionTarget) {
      if (disposed || state) throw new Error('An inspection view is already active or has been disposed');
      state = { target, phase: 'opening', time: 0, pressTime: 0,
        position: camera.position.clone(), rotation: camera.quaternion.clone(), fov: camera.fov,
        returnPosition: camera.position.clone(), returnRotation: camera.quaternion.clone(), returnFov: camera.fov };
      target.display.reset(); document.body.classList.add('quarters-interface'); controls.classList.remove('hidden');
      controls.setAttribute('aria-label', target.title);
      if (target.pointer === 'hand') prepareHand();
      updateInstructions();
    },
    update(dt: number) {
      if (!state || disposed) return;
      state.time += dt; state.pressTime = Math.max(0, state.pressTime - dt); state.target.display.update(dt);
      updateInstructions();
      if (state.phase === 'opening' && state.time >= 0.95 && ready()) {
        state.phase = 'active'; state.target.display.focus(true);
      }
      applyCamera();
      if (state.phase === 'closing' && state.time >= 0.65) {
        state.target.display.reset(); state = null; document.body.classList.remove('quarters-interface'); onClose();
      }
    },
    applyCamera,
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKey, true);
      const wasActive = state !== null;
      state?.target.display.reset(); state = null; hand?.dispose(); controls.remove();
      if (wasActive) document.body.classList.remove('quarters-interface');
    },
  };
}
