export function createHoldToSkip({
  button,
  onSkip,
  isAvailable = () => true,
  isPaused = () => false,
}: {
  button: HTMLButtonElement;
  onSkip: () => void;
  isAvailable?: () => boolean;
  isPaused?: () => boolean;
}) {
  let completed = false,
    disposed = false;
  button.classList.add("hold-to-skip");
  button.textContent = "Press Enter to skip";
  button.title = "Press Enter to skip";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-keyshortcuts", "Enter");

  function reset() {
    completed = false;
    button.style.setProperty("--skip-progress", "0");
  }
  function available() {
    return (
      !disposed &&
      !document.hidden &&
      !isPaused() &&
      isAvailable() &&
      !button.disabled &&
      !button.classList.contains("hidden") &&
      !document.body.classList.contains("quick-menu-open")
    );
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== "Enter" && event.code !== "NumpadEnter") return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (!available()) {
      reset();
      return;
    }
    event.preventDefault();
    if (!completed) {
      completed = true;
      onSkip();
    }
  }
  function onClick(event: MouseEvent) {
    event.preventDefault();
    if (available() && !completed) {
      completed = true;
      onSkip();
    }
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
  button.addEventListener("click", onClick);
  reset();

  return {
    reset,
    update(_delta: number) {
      button.textContent = inputHint("Press Enter to skip");
      button.title = inputHint("Press Enter to skip");
      button.setAttribute("aria-label", button.title);
      if (!available()) {
        reset();
      }
    },
    dispose() {
      disposed = true;
      reset();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      button.removeEventListener("click", onClick);
    },
  };
}
import { inputHint } from "../../scripts/player/gamepadInput.js";
