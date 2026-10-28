import type { ControllerButton } from "./gamepadInput";

export type InputAction =
  | "jump"
  | "attack"
  | "interact"
  | "sprint"
  | "crouch"
  | "viewToggle"
  | "weaponWheel"
  | "dodge"
  | "pause"
  | "map"
  | "confirm"
  | "cancel"
  | "menuUp"
  | "menuDown"
  | "menuLeft"
  | "menuRight"
  | "menuNavigate";

export type KeyboardMapping = Record<string, InputAction>;

export type ControllerMapping = Record<ControllerButton, InputAction | null>;

export const DEFAULT_KEYBOARD_MAPPING: KeyboardMapping = {
  Space: "jump",
  KeyE: "interact",
  KeyR: "attack",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  KeyC: "crouch",
  KeyV: "viewToggle",
  Tab: "weaponWheel",
  KeyB: "dodge",
  Escape: "pause",
  KeyM: "map",
  Enter: "confirm",
  NumpadEnter: "confirm",
  ArrowUp: "menuUp",
  ArrowDown: "menuDown",
  ArrowLeft: "menuLeft",
  ArrowRight: "menuRight",
};

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  a: "jump",
  b: "interact",
  x: "dodge",
  y: "crouch",
  l: "dodge",
  r: "interact",
  zl: "weaponWheel",
  zr: "attack",
  leftStick: "viewToggle",
  rightStick: "sprint",
  minus: "map",
  plus: "pause",
  up: "menuUp",
  down: "menuDown",
  left: "menuLeft",
  right: "menuRight",
};

const storageKey = "input-mappings";

interface StoredMappings {
  keyboard: KeyboardMapping;
  controller: ControllerMapping;
}

let currentMappings: StoredMappings = {
  keyboard: { ...DEFAULT_KEYBOARD_MAPPING },
  controller: { ...DEFAULT_CONTROLLER_MAPPING },
};

export function loadMappings(): void {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StoredMappings>;
      if (parsed.keyboard) {
        currentMappings.keyboard = {
          ...DEFAULT_KEYBOARD_MAPPING,
          ...parsed.keyboard,
        };
      }
      if (parsed.controller) {
        currentMappings.controller = {
          ...DEFAULT_CONTROLLER_MAPPING,
          ...parsed.controller,
        };
      }
    }
  } catch (error) {
    console.warn("Failed to load input mappings:", error);
  }
}

export function saveMappings(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(currentMappings));
  } catch (error) {
    console.warn("Failed to save input mappings:", error);
  }
}

export function getKeyboardMapping(): KeyboardMapping {
  return currentMappings.keyboard;
}

export function getControllerMapping(): ControllerMapping {
  return currentMappings.controller;
}

export function setKeyboardKey(keyCode: string, action: InputAction): void {
  for (const [key, act] of Object.entries(currentMappings.keyboard)) {
    if (act === action) delete currentMappings.keyboard[key];
  }
  currentMappings.keyboard[keyCode] = action;
  saveMappings();
}

export function setControllerButton(
  button: ControllerButton,
  action: InputAction | null,
): void {
  for (const [btn, act] of Object.entries(currentMappings.controller)) {
    if (act === action) {
      currentMappings.controller[btn as ControllerButton] = null;
    }
  }
  currentMappings.controller[button] = action;
  saveMappings();
}

export function resetMappings(): void {
  currentMappings = {
    keyboard: { ...DEFAULT_KEYBOARD_MAPPING },
    controller: { ...DEFAULT_CONTROLLER_MAPPING },
  };
  saveMappings();
}

export function getActionForKey(keyCode: string): InputAction | undefined {
  return currentMappings.keyboard[keyCode];
}

export function getKeysForAction(action: InputAction): string[] {
  return Object.entries(currentMappings.keyboard)
    .filter(([, act]) => act === action)
    .map(([key]) => key);
}

export function getControllerButtonForAction(
  action: InputAction,
): ControllerButton | null {
  for (const [button, act] of Object.entries(currentMappings.controller)) {
    if (act === action) return button as ControllerButton;
  }
  return null;
}
