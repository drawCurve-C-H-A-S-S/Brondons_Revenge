import {
  getActionForKey,
  getControllerMapping,
  type InputAction,
} from "./inputActions";
import type { ControllerContext } from "./gamepadInput";

class InputManager {
  private activeActions = new Set<InputAction>();
  private previousActions = new Set<InputAction>();
  private controllerActions = new Set<InputAction>();
  private previousControllerActions = new Set<InputAction>();

  onKeyDown(event: KeyboardEvent): void {
    const action = getActionForKey(event.code);
    if (action && !event.repeat) {
      this.activeActions.add(action);
    }
  }

  onKeyUp(event: KeyboardEvent): void {
    const action = getActionForKey(event.code);
    if (action) {
      this.activeActions.delete(action);
    }
  }

  updateControllerActions(
    controllerButtons: Set<string>,
    context: ControllerContext,
  ): void {
    this.previousControllerActions = new Set(this.controllerActions);
    this.controllerActions.clear();

    const mapping = getControllerMapping();
    for (const button of controllerButtons) {
      const action = mapping[button as keyof typeof mapping];
      if (action) {
        this.controllerActions.add(action);
      }
    }
  }

  setControllerAction(action: InputAction, down: boolean): void {
    if (down) {
      this.controllerActions.add(action);
    } else {
      this.controllerActions.delete(action);
    }
  }

  clearControllerActions(): void {
    this.previousControllerActions = new Set(this.controllerActions);
    this.controllerActions.clear();
  }

  isActionDown(action: InputAction): boolean {
    return this.activeActions.has(action) || this.controllerActions.has(action);
  }

  isActionPressed(action: InputAction): boolean {
    const keyboardPressed =
      this.activeActions.has(action) && !this.previousActions.has(action);
    const controllerPressed =
      this.controllerActions.has(action) &&
      !this.previousControllerActions.has(action);
    return keyboardPressed || controllerPressed;
  }

  isActionReleased(action: InputAction): boolean {
    const keyboardReleased =
      !this.activeActions.has(action) && this.previousActions.has(action);
    const controllerReleased =
      !this.controllerActions.has(action) &&
      this.previousControllerActions.has(action);
    return keyboardReleased || controllerReleased;
  }

  endFrame(): void {
    this.previousActions = new Set(this.activeActions);
    this.previousControllerActions = new Set(this.controllerActions);
  }

  clear(): void {
    this.activeActions.clear();
    this.previousActions.clear();
    this.controllerActions.clear();
    this.previousControllerActions.clear();
  }
}

export const inputManager = new InputManager();

export function isActionDown(action: InputAction): boolean {
  return inputManager.isActionDown(action);
}

export function isActionPressed(action: InputAction): boolean {
  return inputManager.isActionPressed(action);
}

export function isActionReleased(action: InputAction): boolean {
  return inputManager.isActionReleased(action);
}

export function setControllerAction(action: InputAction, down: boolean): void {
  inputManager.setControllerAction(action, down);
}

export function clearControllerActions(): void {
  inputManager.clearControllerActions();
}
