import * as THREE from "three";

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyH",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);

interface AnalogInput {
  movement: { x: number; y: number };
  look: { x: number; y: number };
  speed: number;
}

const HUD_TEXT =
  "FREE CAMERA  ·  WASD/Left stick move  ·  Space/E or R3 rise  ·  Q/C or Y descend  ·  Shift/LT fast  ·  Right stick/drag look  ·  R3 or Esc exit  ·  P park camera (control player)  ·  H hide this HUD  ·  / hide all HUD";
const HUD_TEXT_PARKED =
  "FREE CAMERA PARKED  ·  camera locked in place  ·  player controls active  ·  P resume camera  ·  Esc exit";

export class FreeCameraController {
  private active = false;
  private parked = false;
  private parkedCamera: THREE.PerspectiveCamera | null = null;
  private readonly held = new Set<string>();
  private readonly savedPosition = new THREE.Vector3();
  private readonly savedQuaternion = new THREE.Quaternion();
  private savedFov = 75;
  private yaw = 0;
  private pitch = 0;
  private hudVisible = true;
  private getAnalogInput: (() => AnalogInput | null) | null = null;
  private onParkCallback: (() => void) | null = null;
  private onUnparkCallback: (() => void) | null = null;
  private readonly hud: HTMLDivElement | null =
    typeof document === "undefined"
      ? null
      : (() => {
          const node = document.createElement("div");
          node.id = "free-camera-hud";
          node.textContent = HUD_TEXT;
          node.hidden = true;
          document.body.appendChild(node);
          return node;
        })();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
  ) {}

  setAnalogInputProvider(provider: (() => AnalogInput | null) | null) {
    this.getAnalogInput = provider;
  }

  setParkCallbacks(onPark: (() => void) | null, onUnpark: (() => void) | null) {
    this.onParkCallback = onPark;
    this.onUnparkCallback = onUnpark;
  }

  isActive() {
    return this.active;
  }

  isParked() {
    return this.parked;
  }

  /**
   * Camera the scene should be rendered with. While parked this is a frozen
   * copy, leaving the gameplay camera free for the player to move normally.
   */
  getRenderCamera(fallback: THREE.PerspectiveCamera) {
    return this.parked && this.parkedCamera ? this.parkedCamera : fallback;
  }

  park() {
    if (!this.active || this.parked) return;
    this.parked = true;
    this.held.clear();
    this.parkedCamera ??= this.camera.clone();
    this.parkedCamera.copy(this.camera);
    this.parkedCamera.updateProjectionMatrix();
    this.parkedCamera.updateMatrixWorld(true);
    if (document.pointerLockElement === this.element)
      document.exitPointerLock();
    // Hand the active camera back to gameplay so the player keeps full,
    // normal control while the frozen copy above provides the picture.
    this.camera.position.copy(this.savedPosition);
    this.camera.quaternion.copy(this.savedQuaternion);
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.syncHud();
    this.onParkCallback?.();
  }

  unpark() {
    if (!this.parked) return;
    this.parked = false;
    // Remember the live gameplay pose so leaving free camera later returns
    // to wherever the player actually is, not the pre-free-cam spot.
    this.savedPosition.copy(this.camera.position);
    this.savedQuaternion.copy(this.camera.quaternion);
    this.savedFov = this.camera.fov;
    if (this.parkedCamera) {
      this.camera.position.copy(this.parkedCamera.position);
      this.camera.quaternion.copy(this.parkedCamera.quaternion);
      this.camera.fov = this.parkedCamera.fov;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
      this.parkedCamera = null;
    }
    const euler = new THREE.Euler().setFromQuaternion(
      this.camera.quaternion,
      "YXZ",
    );
    this.yaw = euler.y;
    this.pitch = THREE.MathUtils.clamp(euler.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.syncHud();
    this.onUnparkCallback?.();
  }

  togglePark() {
    if (this.parked) {
      this.unpark();
    } else {
      this.park();
    }
  }

  toggleHud() {
    this.hudVisible = !this.hudVisible;
    this.syncHud();
  }

  private syncHud() {
    if (!this.hud || !this.active) return;
    this.hud.textContent = this.parked ? HUD_TEXT_PARKED : HUD_TEXT;
    if (this.hudVisible) this.hud.removeAttribute("hidden");
    else this.hud.setAttribute("hidden", "");
  }

  enter() {
    if (this.active) return;
    this.savedPosition.copy(this.camera.position);
    this.savedQuaternion.copy(this.camera.quaternion);
    this.savedFov = this.camera.fov;
    const euler = new THREE.Euler().setFromQuaternion(
      this.camera.quaternion,
      "YXZ",
    );
    this.yaw = euler.y;
    this.pitch = THREE.MathUtils.clamp(euler.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.active = true;
    this.held.clear();
    this.syncHud();
    this.element.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  exit() {
    if (!this.active) return;
    const parkedLiveCamera = this.parked;
    this.active = false;
    this.parked = false;
    this.parkedCamera = null;
    this.held.clear();
    // Parked means the gameplay camera was running live; leave it untouched.
    if (!parkedLiveCamera) {
      this.camera.position.copy(this.savedPosition);
      this.camera.quaternion.copy(this.savedQuaternion);
      this.camera.fov = this.savedFov;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
    }
    if (document.pointerLockElement === this.element)
      document.exitPointerLock();
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.hud?.setAttribute("hidden", "");
  }

  update(dt: number) {
    // While parked the player owns the camera; nothing to drive here.
    if (!this.active || this.parked) return;
    const frame = THREE.MathUtils.clamp(
      Number.isFinite(dt) ? dt : 0,
      0,
      0.1,
    );
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    
    const analog = this.getAnalogInput?.();
    const movement = new THREE.Vector3();
    let speedMultiplier = 1;
    
    if (analog) {
      // Use analog stick input for variable speed movement
      if (Math.abs(analog.movement.y) > 0.01) {
        movement.addScaledVector(forward, -analog.movement.y);
      }
      if (Math.abs(analog.movement.x) > 0.01) {
        movement.addScaledVector(right, analog.movement.x);
      }
      // Vertical movement from buttons (mapped to keyboard events)
      if (this.held.has("Space") || this.held.has("KeyE")) {
        movement.y += 1;
      }
      if (this.held.has("KeyC") || this.held.has("KeyQ")) {
        movement.y -= 1;
      }
      // Analog speed control (0 to 1, where 1 is full speed)
      speedMultiplier = 1 + analog.speed * 2; // 1x to 3x base speed
    } else {
      // Keyboard input (digital)
      if (this.held.has("KeyW")) movement.add(forward);
      if (this.held.has("KeyS")) movement.sub(forward);
      if (this.held.has("KeyD")) movement.add(right);
      if (this.held.has("KeyA")) movement.sub(right);
      if (this.held.has("Space") || this.held.has("KeyE")) {
        movement.y += 1;
      }
      if (this.held.has("KeyC") || this.held.has("KeyQ")) {
        movement.y -= 1;
      }
      if (movement.lengthSq() > 0) movement.normalize();
      const fast = this.held.has("ShiftLeft") || this.held.has("ShiftRight");
      speedMultiplier = fast ? 3 : 1;
    }
    
    const baseSpeed = 8;
    this.camera.position.addScaledVector(movement, frame * baseSpeed * speedMultiplier);
    
    // Apply analog look input
    if (analog && (Math.abs(analog.look.x) > 0.01 || Math.abs(analog.look.y) > 0.01)) {
      const lookSpeed = 2.5;
      this.yaw -= analog.look.x * lookSpeed * frame;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - analog.look.y * lookSpeed * frame,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
      );
    }
    
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.updateMatrixWorld(true);
  }

  dispose() {
    this.exit();
    this.hud?.remove();
  }

  private onPointerDown = () => {
    if (!this.active || this.parked) return;
    if (document.pointerLockElement !== this.element)
      void this.element.requestPointerLock?.();
  };

  private onMouseMove = (event: MouseEvent) => {
    if (!this.active || this.parked) return;
    if (document.pointerLockElement !== this.element && event.buttons === 0)
      return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - event.movementY * 0.0022,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.active) return;
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.exit();
      return;
    }
    if (event.code === "KeyH") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleHud();
      return;
    }
    if (event.code === "Slash") {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.body.classList.toggle("hud-hidden");
      return;
    }
    if (event.code === "KeyP") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.togglePark();
      return;
    }
    // Parked: movement keys belong to the player, so let them through.
    if (this.parked) return;
    if (!MOVE_KEYS.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.held.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (!this.active || this.parked || !MOVE_KEYS.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.held.delete(event.code);
  };

  private onBlur = () => {
    this.held.clear();
  };
}
