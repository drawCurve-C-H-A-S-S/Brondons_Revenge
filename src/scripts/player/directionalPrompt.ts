import {
  controllerLabel,
  getControllerType,
  isControllerActive,
  type ControllerContext,
} from "./gamepadInput.js";
import { createControllerIcon } from "./controllerIcons.js";

const DIRECTIONS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
  KeyQ: [0, 1],
  KeyT: [0, -1],
  KeyR: [-1, 0],
};
export function renderDirectionalPrompt(
  element: HTMLElement,
  codes: readonly string[],
  context: ControllerContext = "foot",
) {
  const controller = isControllerActive();
  const prompts = codes.map((code) => ({
    code,
    label: controller
      ? controllerLabel(code, context)
      : code.replace(/^Key|^Digit/, ""),
  }));
  const signature = JSON.stringify([
    controller,
    getControllerType(),
    context,
    prompts,
  ]);
  if (element.dataset.directionPrompt === signature && element.children.length)
    return;
  element.dataset.directionPrompt = signature;
  const nodes = prompts.map(({ code, label }) => {
    const key = document.createElement("span");
    key.className = "direction-prompt-key";
    key.setAttribute("aria-label", label);
    key.title = label;
    const direction = DIRECTIONS[code];
    const stick = controller && /stick/i.test(label);
    const dpad = controller && /d-pad/i.test(label);
    if (!controller) {
      key.textContent = label;
      return key;
    }
    key.setAttribute("role", "img");
    const svg = createControllerIcon(
      label,
      stick || dpad ? direction : undefined,
    );
    svg.classList.add("direction-prompt-icon");
    key.appendChild(svg);
    return key;
  });
  element.replaceChildren(...nodes);
}
