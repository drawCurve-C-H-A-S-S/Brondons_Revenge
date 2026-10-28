import * as THREE from "three";
import type { Player } from "../player/player.js";
import { setInputHint } from "./inputPrompts.js";
import { isActionPressed } from "../player/inputManager.js";

export interface CameraVisitOptions {
  title: string;
  player: Player;
  hasReturnMarker?: () => boolean;
  onRestart: () => Promise<boolean>;
  canInteract?: () => boolean;
}

export function createCameraVisitUI({
  title,
  player,
  onRestart,
  canInteract = () => true,
}: CameraVisitOptions) {
  const root = document.createElement("section");
  root.className = "camera-visit-ui";
  const roomName = document.createElement("div");
  roomName.className = "room-name-tag";
  roomName.textContent = title;
  const help = document.createElement("p");
  help.className = "hidden";
  const restart = document.createElement("button");
  restart.type = "button";
  setInputHint(restart, "R / Camera room");
  restart.setAttribute("aria-label", "Return to the camera room");
  root.append(help, restart);
  document.body.append(root, roomName);
  let restarting = false,
    disposed = false,
    visible = true,
    ownsPrompt = false,
    lockedNotice = false;
  const exits = new Set<{
      root: THREE.Object3D | { x: number; y?: number; z: number };
      range: number;
    }>(),
    exitPoint = new THREE.Vector3(),
    prompt = document.getElementById("interact-prompt");
  function nearLockedExit() {
    for (const { root, range } of exits) {
      if (root instanceof THREE.Object3D) root.getWorldPosition(exitPoint);
      else exitPoint.set(root.x, root.y ?? player.body.position.y, root.z);
      if (
        Math.hypot(
          player.body.position.x - exitPoint.x,
          player.body.position.z - exitPoint.z,
        ) < range &&
        Math.abs(player.body.position.y - exitPoint.y) < 3
      )
        return true;
    }
    return false;
  }
  async function restartVisit() {
    if (
      disposed ||
      restarting ||
      !visible ||
      !player.isEnabled() ||
      !canInteract() ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    restarting = true;
    player.disable();
    restart.disabled = true;
    setInputHint(restart, "Returning...");
    try {
      if (!(await onRestart()))
        throw new Error("The surveillance checkpoint transfer was cancelled");
    } catch (error) {
      if (disposed) return;
      console.error("[CameraVisit] Checkpoint restart failed:", error);
      setInputHint(
        help,
        "Camera room could not be loaded. Press R to retry.",
        "foot",
        true,
      );
      help.classList.remove("hidden");
      restart.disabled = false;
      player.enable();
      restarting = false;
    }
  }
  function onKey(event: KeyboardEvent) {
    if (
      (event.code !== "KeyR" && event.code !== "KeyE") ||
      event.repeat ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      !visible ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open") ||
      !player.isEnabled() ||
      !canInteract()
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(
        'button, input, textarea, select, [contenteditable="true"]',
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void restartVisit();
  }
  restart.addEventListener("click", () => {
    void restartVisit();
  });
  window.addEventListener("keydown", onKey, true);
  return {
    registerLockedExit(
      root: THREE.Object3D | { x: number; y?: number; z: number },
      range = 2.6,
    ) {
      const exit = { root, range };
      exits.add(exit);
      return () => exits.delete(exit);
    },
    setVisible(value: boolean) {
      visible = value;
      root.classList.toggle("hidden", !value);
      roomName.classList.toggle("hidden", !value);
      if (!value && ownsPrompt) {
        prompt?.classList.add("hidden");
        ownsPrompt = false;
      }
    },
    update() {
      if (disposed || restarting) return;
      const near =
        visible &&
        canInteract() &&
        player.isEnabled() &&
        !document.hidden &&
        !document.body.classList.contains("quick-menu-open") &&
        nearLockedExit();
      if (near && prompt) {
        setInputHint(prompt, "E / Locked exit");
        prompt.classList.remove("hidden");
        ownsPrompt = true;
      } else if (ownsPrompt) {
        prompt?.classList.add("hidden");
        ownsPrompt = false;
      }
      if (!near && lockedNotice) {
        help.classList.add("hidden");
        lockedNotice = false;
      }
      // Check interact action for locked exit notice
      if (
        isActionPressed("interact") &&
        visible &&
        canInteract() &&
        player.isEnabled() &&
        !document.hidden &&
        !document.body.classList.contains("quick-menu-open") &&
        nearLockedExit()
      ) {
        lockedNotice = true;
        setInputHint(
          help,
          "Locked. Press R to return to the camera room.",
          "foot",
          true,
        );
        help.classList.remove("hidden");
      }
    },
    dispose() {
      disposed = true;
      window.removeEventListener("keydown", onKey, true);
      if (ownsPrompt) prompt?.classList.add("hidden");
      exits.clear();
      root.remove();
      roomName.remove();
    },
  };
}
