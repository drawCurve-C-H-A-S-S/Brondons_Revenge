import * as THREE from "three";

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);

export class FreeCameraController {
  private active = false;
  private readonly held = new Set<string>();
  private readonly savedPosition = new THREE.Vector3();
  private readonly savedQuaternion = new THREE.Quaternion();
  private savedFov = 75;
  private yaw = 0;
  private pitch = 0;
  private readonly hud: HTMLDivElement | null =
    typeof document === "undefined"
      ? null
      : (() => {
          const node = document.createElement("div");
          node.id = "free-camera-hud";
          node.textContent =
            "FREE CAMERA  ·  WASD move  ·  Space / C rise / descend  ·  Shift fast  ·  drag to look  ·  = exit";
          node.hidden = true;
          document.body.appendChild(node);
          return node;
        })();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
  ) {}

  isActive() {
    return this.active;
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
    this.hud?.removeAttribute("hidden");
    this.element.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.held.clear();
    this.camera.position.copy(this.savedPosition);
    this.camera.quaternion.copy(this.savedQuaternion);
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
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
    if (!this.active) return;
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
    const movement = new THREE.Vector3();
    if (this.held.has("KeyW")) movement.add(forward);
    if (this.held.has("KeyS")) movement.sub(forward);
    if (this.held.has("KeyD")) movement.add(right);
    if (this.held.has("KeyA")) movement.sub(right);
    if (this.held.has("Space") || this.held.has("KeyE"))
      movement.y += 1;
    if (this.held.has("KeyC") || this.held.has("KeyQ"))
      movement.y -= 1;
    if (movement.lengthSq() > 0) movement.normalize();
    const fast = this.held.has("ShiftLeft") || this.held.has("ShiftRight");
    this.camera.position.addScaledVector(movement, frame * (fast ? 24 : 8));
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.updateMatrixWorld(true);
  }

  dispose() {
    this.exit();
    this.hud?.remove();
  }

  private onPointerDown = () => {
    if (this.active && document.pointerLockElement !== this.element)
      void this.element.requestPointerLock?.();
  };

  private onMouseMove = (event: MouseEvent) => {
    if (!this.active) return;
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
    if (!MOVE_KEYS.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.held.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (!this.active || !MOVE_KEYS.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.held.delete(event.code);
  };

  private onBlur = () => {
    this.held.clear();
  };
}
