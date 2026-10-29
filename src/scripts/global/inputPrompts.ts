import {
  inputDialogue,
  inputHint,
  type ControllerContext,
} from "../player/gamepadInput.js";
import { renderControllerPrompt, renderDpadText } from "../player/controllerIcons.js";
import { sayDialogue, stopDialogueVoice } from "../../helpers/audio/dialogueVoice.js";

export function formatDialogue(element: HTMLElement, text: string, source = text) {
  const match =
    /^(Prime|Brondon|Branden|Brendan|Donus|Caleb|Husain|André|Sibusiso|Sohrab|Sudoers 5):\s*/i.exec(
      text,
    );
  if (!match) {
    if (text !== element.dataset.dialogueLine) {
      if (element.dataset.dialogueSpeaker) stopDialogueVoice(element);
      delete element.dataset.dialogueSpeaker;
      delete element.dataset.dialogueLine;
      delete element.dataset.primeLine;
      element.classList.remove(
        "dialogue-tagged",
        "prime-tagged",
        "prime-top-left",
      );
    }
    return text;
  }
  const speaker = match[1].toUpperCase();
  const line = text.slice(match[0].length);
  sayDialogue(element, speaker, source.replace(/^[^:]+:\s*/, ""));
  element.dataset.dialogueSpeaker = speaker;
  element.dataset.dialogueLine = line;
  element.classList.add("dialogue-tagged");
  element.classList.toggle("prime-top-left", speaker === "PRIME");
  element.classList.toggle("prime-tagged", speaker === "PRIME");
  if (speaker === "PRIME") element.dataset.primeLine = line;
  return line;
}

export function setInputHint(
  element: HTMLElement,
  text: string,
  context: ControllerContext = "foot",
  dialogue = false,
  primeHint = false,
) {
  if (primeHint) element.dataset.primeHint = "true";
  else delete element.dataset.primeHint;
  element.dataset.inputHint = text;
  element.dataset.inputContext = context;
  element.dataset.inputDialogue = String(dialogue);
  const converted = (dialogue ? inputDialogue : inputHint)(text, context);
  const rendered = dialogue ? formatDialogue(element, converted, text) : converted;
  renderControllerPrompt(element, rendered);
  element.dataset.inputRendered = element.textContent ?? "";
}

// Other HUDs already call inputHint each frame. Never translate their *output*
// again (for example the Switch R in an already-formatted "Press R" prompt).
const prompts =
  "[data-input-hint], .prologue-dialogue-hint, .scene-menu-footer, .credit-dialog-hint, .escape-hint";
const controlsOnly =
  ".prologue-dialogue-hint, .escape-hint, .scene-menu-footer, .credit-dialog-hint";
const excluded =
  "#touch-controls, .finale-touch, #credits-content, #credits-dialog-content, .controller-binding-icon, .direction-prompt-key, svg, input, textarea, option, script, style";

/**
 * Retain keyboard source text, not already-translated labels. Watching text nodes
 * preserves <kbd>, icons and emphasis, including dialogue inserted after startup.
 * No timers or gameplay state are touched when the active device changes.
 */
export function createInputPromptObserver(root: HTMLElement = document.body) {
  const sources = new WeakMap<Text, { source: string; rendered: string }>();
  function update(text: Text) {
    const parent = text.parentElement;
    if (!parent || parent.closest(excluded)) return;
    const explicit = parent.closest<HTMLElement>("[data-input-hint]");
    if (explicit) {
      const expected = explicit.dataset.inputRendered;
      const current = explicit.textContent;
      // Shared HUD nodes have several owners. An external write ends this
      // binding; a device refresh must never resurrect an old teleport notice.
      const primeStyled =
        explicit.classList.contains("prime-tagged") &&
        current === expected?.replace(/^prime:\s*/i, "");
      if (expected !== undefined && current !== expected && !primeStyled) {
        delete explicit.dataset.inputHint;
        delete explicit.dataset.inputRendered;
        delete explicit.dataset.inputContext;
        delete explicit.dataset.inputDialogue;
        delete explicit.dataset.primeHint;
        return;
      }
      setInputHint(
        explicit,
        explicit.dataset.inputHint ?? "",
        explicit.dataset.inputContext as ControllerContext,
        explicit.dataset.inputDialogue === "true",
        explicit.dataset.primeHint === "true",
      );
      return;
    }
    if (parent.closest("[data-controller-prompt]")) return;
    if (!parent.closest(prompts)) {
      renderDpadText(text);
      return;
    }
    const previous = sources.get(text);
    const source =
      previous && text.data === previous.rendered ? previous.source : text.data;
    const context: ControllerContext =
      (parent.closest<HTMLElement>("[data-input-context]")?.dataset
        .inputContext as ControllerContext) ??
      (parent.closest(".finale-hud")
        ? "finale"
        : parent.closest("#escape-qte")
          ? "escape"
          : parent.closest("#flight-controls, #space-pause")
            ? "flight"
            : "foot");
    const rendered = (parent.closest(controlsOnly) ? inputHint : inputDialogue)(
      source,
      context,
    );
    sources.set(text, { source, rendered });
    if (/\bD[- ]?pad\b/i.test(rendered)) {
      const binding = document.createElement("span");
      setInputHint(binding, source, context, !parent.closest(controlsOnly));
      text.replaceWith(binding);
    } else if (rendered !== text.data) text.data = rendered;
  }
  function scan(node: Node) {
    if (node.nodeType === 3) {
      update(node as Text);
      return;
    }
    const walker = document.createTreeWalker(node, 4 /* SHOW_TEXT */);
    const texts: Text[] = [];
    let text: Node | null;
    while ((text = walker.nextNode())) texts.push(text as Text);
    for (const text of texts) update(text);
  }
  const refresh = () => scan(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") scan(record.target);
      else for (const node of record.addedNodes) scan(node);
    }
  });
  observer.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.addEventListener("input-device-change", refresh);
  refresh();
  return {
    refresh,
    dispose() {
      observer.disconnect();
      window.removeEventListener("input-device-change", refresh);
    },
  };
}
