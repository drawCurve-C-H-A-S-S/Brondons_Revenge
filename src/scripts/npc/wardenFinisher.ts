import * as THREE from "three";
import { loadToolModel } from "../../core/loader.js";
import { playSfx } from "../../helpers/audio/sfx.js";
import type { CinematicPose } from "../player/characterManager.js";
import type { Player } from "../player/player.js";
import { renderDirectionalPrompt } from "../player/directionalPrompt.js";
import type { createLoadingBayBoss } from "./mechBaymaxBoss.js";
import { createBladeTrail } from "../level-3/finaleEffects.js";

type Stage = "shoot" | "shot" | "fall" | "mount" | "jump" | "cut" | "slash";
type Actor = { model: THREE.Object3D; weapon?: { socket: THREE.Object3D | null } };

export function createWardenFinisher(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  player: Player,
  boss: ReturnType<typeof createLoadingBayBoss>,
  onComplete: () => void,
  onFailure: () => void,
  resolveCamera: (focus: THREE.Vector3, desired: THREE.Vector3) => THREE.Vector3,
  instruction: (text: string | null) => void,
) {
  const prompt = document.getElementById("escape-qte");
  if (!prompt) throw new Error("The shared hangar QTE panel is missing");
  const part = (selector: string) => {
    const element = prompt.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`The Warden QTE needs ${selector}`);
    return element;
  };
  const label = part("#escape-action"), key = part("#escape-key"),
    caption = part(".escape-caption"), hint = part(".escape-hint"),
    fill = part("#escape-timer-fill");
  const original = {
    style: prompt.getAttribute("style"), captionStyle: caption.getAttribute("style"),
    caption: caption.textContent, label: label.textContent, hint: hint.textContent,
    key: key.innerHTML, aria: prompt.getAttribute("aria-label"),
  };
  prompt.setAttribute("aria-label", "Warden finishing action");
  prompt.style.pointerEvents = "auto";
  prompt.classList.add("hidden", "letter-prompt");
  let cue = "";
  function present(mode: string, code: string, word: string, text: string, teleport = false) {
    prompt.classList.remove("hidden");
    prompt.classList.add("letter-prompt");
    prompt.style.pointerEvents = "auto";
    prompt.style.opacity = "1";
    if (cue !== mode) {
      cue = mode;
      caption.textContent = word;
      label.textContent = text;
      hint.textContent = teleport
        ? "Hold Q to charge. Click to throw. Press T to teleport."
        : "Y: shoot the core. U: jump onto the bot. I: cut it in half.";
      if (teleport)
        caption.style.cssText = "position:static;width:auto;height:auto;overflow:visible;clip-path:none;margin-bottom:4px;font:400 14px/1.2 var(--comic-display);color:var(--comic-ink)";
      else if (original.captionStyle === null) caption.removeAttribute("style");
      else caption.setAttribute("style", original.captionStyle);
    }
    instruction(text);
    renderDirectionalPrompt(key, [code], teleport ? "foot" : "escape");
  }
  const trail = createBladeTrail(scene, "hero");
  const bladeBase = new THREE.Vector3(), bladeTip = new THREE.Vector3();
  const flash = document.createElement("div");
  flash.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1500;background:#d8f8ff;opacity:0";
  document.body.appendChild(flash);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const beamGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const beamMaterial = new THREE.LineBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 1, depthTest: false });
  const beam = new THREE.Line(beamGeometry, beamMaterial);
  beam.frustumCulled = false;
  beam.visible = false;
  beam.userData.minimap = false;
  scene.add(beam);
  const waveShape = new THREE.Shape();
  waveShape.moveTo(-0.12, -1);
  waveShape.quadraticCurveTo(0.7, 0, -0.12, 1);
  waveShape.lineTo(0.06, 1);
  waveShape.quadraticCurveTo(1.05, 0, 0.06, -1);
  waveShape.closePath();
  const waveGeometry = new THREE.ShapeGeometry(waveShape, 24);
  const waveMaterial = new THREE.MeshBasicMaterial({
    color: 0x43ccff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    depthWrite: false, depthTest: false, toneMapped: false,
  });
  const waveCoreMaterial = waveMaterial.clone();
  waveCoreMaterial.color.setHex(0xf1ffff);
  const wave = new THREE.Group();
  wave.name = "WardenLightsaberCutWave";
  wave.visible = false;
  wave.userData.minimap = false;
  wave.userData.preserveComicAppearance = true;
  const waveHalo = new THREE.Mesh(waveGeometry, waveMaterial);
  const waveCore = new THREE.Mesh(waveGeometry, waveCoreMaterial);
  waveCore.scale.set(0.7, 0.88, 1);
  waveCore.position.z = 0.01;
  waveHalo.frustumCulled = waveCore.frustumCulled = false;
  wave.add(waveHalo, waveCore);
  scene.add(wave);
  const waveStart = new THREE.Vector3(), waveDirection = new THREE.Vector3();
  let waveStarted = false, waveReach = 0;
  const start = new THREE.Vector3(), mount = new THREE.Vector3(),
    target = new THREE.Vector3(), focus = new THREE.Vector3(),
    cameraPosition = new THREE.Vector3(), cameraFocus = new THREE.Vector3(),
    muzzle = new THREE.Vector3();
  const bounds = new THREE.Box3();
  const events = new AbortController();
  let active = false, disposed = false, paused = false, inputReady = false, clock = 0,
    stage: Stage = "shoot", impact = false, actor: Actor | null = null,
    gun: THREE.Group | null = null, frameDelta = 0;
  const ready = loadToolModel("Gun_Revolver").then((asset) => {
    gun = asset.scene;
    gun.rotation.y = -Math.PI / 2;
    gun.visible = false;
    gun.userData.minimap = false;
    gun.userData.preserveComicAppearance = true;
    scene.add(gun);
    if (disposed) disposeGun();
  });
  function disposeGun() {
    if (!gun) return;
    gun.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    gun.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    gun = null;
  }
  function waiting() {
    return stage === "shoot" || stage === "mount" || stage === "cut";
  }
  function hidden() {
    return paused || document.hidden || document.body.classList.contains("quick-menu-open");
  }
  function expected() {
    return stage === "shoot" ? "KeyY" : stage === "mount" ? "KeyU" : "KeyI";
  }
  function hide() {
    prompt.classList.add("hidden");
    prompt.classList.remove("urgent");
    if (cue) instruction(null);
    cue = "";
    beam.visible = false;
    wave.visible = false;
    flash.style.opacity = "0";
    trail.clear();
    gun?.removeFromParent();
  }
  function accept() {
    if (!active || !inputReady || !waiting() || hidden()) return;
    inputReady = false;
    stage = stage === "shoot" ? "shot" : stage === "mount" ? "jump" : "slash";
    clock = 0;
    impact = false;
    start.copy(player.body.position);
    if (stage === "shot") playSfx("gunshot", 0.9);
    if (stage === "jump") {
      boss.getCinematicBounds(bounds);
      bounds.getCenter(mount);
      mount.y = bounds.max.y + player.radius + 0.04;
      playSfx("servo", 0.6);
    }
    prompt.classList.add("hidden");
    instruction(null);
  }
  window.addEventListener("keydown", (event) => {
    if (!active || !inputReady || hidden() || event.repeat || !waiting()) return;
    if (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;
    if (!["KeyY", "KeyU", "KeyI"].includes(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === expected()) accept();
    else {
      active = false;
      hide();
      onFailure();
    }
  }, { capture: true, signal: events.signal });
  prompt.addEventListener("pointerdown", (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    accept();
  }, { signal: events.signal });
  function next(nextStage: Stage) {
    stage = nextStage;
    clock = 0;
    impact = false;
    inputReady = false;
    waveStarted = false;
  }
  return {
    ready,
    get active() { return active; },
    get stage() { return stage; },
    start() {
      if (disposed || !boss.beginFinisher()) return false;
      hide();
      active = true;
      next("shoot");
      start.copy(player.body.position);
      cameraPosition.copy(camera.position);
      camera.getWorldDirection(cameraFocus).multiplyScalar(5).add(camera.position);
      return true;
    },
    pause(value: boolean) {
      paused = value;
      if (value) {
        inputReady = false;
        hide();
      }
    },
    stop() {
      active = false;
      hide();
    },
    teleportCue(mode: "hold" | "charging" | "flight" | "teleport" | "recharging" | null, progress = 0) {
      if (active) return;
      if (!mode || hidden()) {
        hide();
        return;
      }
      const teleport = mode === "teleport" || mode === "flight";
      const text = teleport
        ? mode === "flight" ? "Let the crystal land, then press T." : "Press T. Teleport behind him."
        : mode === "recharging" ? "Let the crystal recharge."
          : "Hold Q to charge. Aim behind him and click to throw.";
      present(`teleport-${mode}`, teleport ? "KeyT" : "KeyQ",
        teleport ? "PRESS" : "HOLD", text, true);
      prompt.style.pointerEvents = "none";
      prompt.classList.remove("urgent");
      prompt.style.setProperty("--qte-pulse", String(progress));
      prompt.style.opacity = mode === "recharging" || mode === "flight" ? "0.65" : "1";
      fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    },
    update(dt: number) {
      if (!active || hidden()) return;
      const hitStop = stage === "slash" && clock >= 0.8 && clock < 0.86;
      frameDelta = dt * (hitStop ? 0.25 : 1);
      clock += frameDelta;
      boss.getBackWorldPosition(target);
      if (waiting()) {
        inputReady = true;
        present(stage, expected(), "PRESS THE DISPLAYED BUTTON",
          stage === "shoot" ? "Shoot the blue core on his back."
            : stage === "mount" ? "Jump onto him, Brondon." : "One clean cut. Split the frame.");
        prompt.classList.toggle("urgent", clock >= 3.5);
        prompt.style.setProperty("--qte-pulse", String(Math.max(0, Math.sin(clock * 6)) * clock / 5));
        fill.style.width = `${Math.max(0, 1 - clock / 5) * 100}%`;
        if (clock >= 5) {
          active = false;
          hide();
          onFailure();
          return;
        }
      }
      const slashAge = stage === "slash" ? clock - 0.8 : -1;
      flash.style.opacity = reducedMotion || slashAge < 0
        ? "0" : String(Math.max(0, 0.24 * (1 - slashAge / 0.12)));
      if (stage === "shoot" || stage === "shot") {
        const p = player.body.position;
        player.setRotation(
          Math.atan2(p.x - target.x, p.z - target.z),
          Math.atan2(target.y - player.getHeadY(), Math.hypot(p.x - target.x, p.z - target.z)),
        );
      }
      beam.visible = stage === "shot" && clock < 0.22;
      if (stage === "shot") {
        if (!impact && clock >= 0.18) {
          impact = true;
          boss.shootFinisherCore();
        }
        if (clock >= 0.55) next("fall");
      } else if (stage === "fall") {
        boss.setFinisherDrop(THREE.MathUtils.smootherstep(clock, 0, 2.2));
        if (clock >= 2.2) next("mount");
      } else if (stage === "jump") {
        const p = THREE.MathUtils.clamp(clock / 1.8, 0, 1);
        const at = start.clone().lerp(mount, THREE.MathUtils.smootherstep(p, 0, 1));
        const apex = Math.min(12.5, Math.max(start.y, mount.y) + 3.2);
        at.y += Math.sin(p * Math.PI) * Math.max(0, apex - Math.max(start.y, mount.y));
        player.setPosition(at.x, at.y, at.z);
        player.setRotation(boss.getYaw() + Math.PI, 0);
        if (clock >= 1.8) next("cut");
      } else if (stage === "slash") {
        if (!impact && clock >= 0.8) {
          impact = true;
          playSfx("clank", 0.9);
        }
        if (clock >= 1.6) {
          active = false;
          hide();
          onComplete();
        }
      }
    },
    pose(): CinematicPose {
      if (stage === "shoot" || stage === "shot")
        return {
          clip: "Float_Loop", time: clock, loop: true,
          upperBody: { clip: stage === "shot" ? "Pistol_Shoot" : "Pistol_Aim_Neutral", time: clock, pitch: player.getState().pitch },
        };
      if (stage === "jump")
        return clock < 0.35
          ? { clip: "Jump_Start", time: clock, duration: 0.35, loop: false }
          : clock < 1.4
            ? { clip: "Jump_Loop", time: clock - 0.35, loop: true }
            : { clip: "Jump_Land", time: clock - 1.4, duration: 0.4, loop: false };
      if (stage === "cut" || stage === "slash")
        return { clip: stage === "slash" ? "Sword_Attack" : "Sword_Idle", time: clock, duration: stage === "slash" ? 1.6 : undefined, loop: stage === "cut" };
      return { clip: "Float_Loop", time: clock, loop: true };
    },
    character(value: Actor | null) {
      actor = value;
      if (!actor || !active) return;
      if ((stage === "shoot" || stage === "shot") && gun && actor.weapon?.socket) {
        actor.weapon.socket.add(gun);
        gun.position.set(0, 0.02, 0);
        gun.visible = true;
        actor.weapon.socket.updateWorldMatrix(true, true);
        muzzle.copy(actor.weapon.socket.localToWorld(new THREE.Vector3(0, 0.12, -0.38)));
        beam.geometry.setFromPoints([muzzle, boss.getBackWorldPosition(target)]);
      } else gun?.removeFromParent();
      const sword = actor.model.getObjectByName("bloomstick");
      if (sword) sword.visible = stage === "cut" || stage === "slash";
      if (sword) {
        sword.updateWorldMatrix(true, true);
        sword.localToWorld(bladeBase.set(0, 0.32, 0));
        sword.localToWorld(bladeTip.set(0, 1.22, 0));
        trail.update(bladeBase, bladeTip, frameDelta, stage === "slash", 1);
      }
      if (stage === "slash" && clock >= 0.8) {
        boss.getCinematicBounds(bounds);
        const center = bounds.getCenter(new THREE.Vector3());
        if (!waveStarted) {
          if (sword) {
            sword.updateWorldMatrix(true, true);
            waveStart.copy(sword.localToWorld(new THREE.Vector3(0, 1.22, 0)));
          } else {
            actor.model.getWorldPosition(waveStart).add(new THREE.Vector3(0, 1.3, 0));
          }
          waveDirection.copy(center).sub(waveStart);
          if (waveDirection.lengthSq() < 1e-6) waveDirection.set(0, -1, 0);
          waveDirection.normalize();
          waveReach = Math.max(6, bounds.getSize(new THREE.Vector3()).length() * 0.85);
          wave.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), waveDirection);
          waveStarted = true;
        }
        const progress = THREE.MathUtils.clamp((clock - 0.8) / 0.8, 0, 1);
        wave.position.copy(waveStart).addScaledVector(waveDirection, waveReach * progress);
        wave.scale.set(1 + progress * 2.2, 1.4 + progress * 3.2, 1);
        waveMaterial.opacity = Math.sin(progress * Math.PI) * 0.85;
        waveCoreMaterial.opacity = Math.sin(progress * Math.PI);
        wave.visible = true;
        beam.geometry.setFromPoints([
          boss.root.localToWorld(new THREE.Vector3(0, 8.4, -0.05)),
          boss.root.localToWorld(new THREE.Vector3(0, 0.15, 0.05)),
        ]);
        beamMaterial.opacity = Math.max(0.35, 1 - (clock - 0.8));
        beam.visible = true;
      } else beamMaterial.opacity = 1;
    },
    camera(dt: number) {
      if (!active || hidden()) return;
      const p = new THREE.Vector3().copy(player.body.position);
      boss.getBackWorldPosition(target);
      const rear = new THREE.Vector3(-Math.sin(boss.getYaw()), 0, -Math.cos(boss.getYaw()));
      const right = new THREE.Vector3(rear.z, 0, -rear.x);
      const portrait = Math.max(1, 1.2 / camera.aspect);
      let lens = 58;
      let desired: THREE.Vector3;
      if (stage === "shoot") {
        focus.copy(target).lerp(p.clone().add(new THREE.Vector3(0, 1.2, 0)), 0.25);
        desired = p.clone().addScaledVector(rear, 3.8 * portrait)
          .addScaledVector(right, 1.9).add(new THREE.Vector3(0, 1.7, 0));
      } else if (stage === "shot") {
        focus.copy(target);
        desired = target.clone().addScaledVector(rear, 3 * portrait)
          .addScaledVector(right, 2.1).add(new THREE.Vector3(0, 0.9, 0));
      } else if (stage === "jump") {
        focus.copy(p).add(new THREE.Vector3(0, 1.1, 0));
        desired = focus.clone().addScaledVector(rear, 5 * portrait)
          .addScaledVector(right, 3.6).add(new THREE.Vector3(0, 0.45, 0));
      } else if (stage === "slash" && clock < 0.72) {
        focus.copy(p).add(new THREE.Vector3(0, 1.2, 0)).lerp(bladeTip, 0.25);
        desired = focus.clone().addScaledVector(rear, 3.6 * portrait)
          .addScaledVector(right, 2.5).add(new THREE.Vector3(0, 0.65, 0));
        lens = 48;
      } else if (stage === "cut" || stage === "slash") {
        const release = stage === "slash" ? THREE.MathUtils.smootherstep(clock, 0.4, 1.6) : 0;
        focus.copy(p).add(new THREE.Vector3(0, 1, 0)).lerp(target, release * 0.55);
        desired = focus.clone().addScaledVector(rear, (4.8 + release * 4) * portrait)
          .addScaledVector(right, 3.4 + release * 3)
          .add(new THREE.Vector3(0, 1.1 + release * 1.6, 0));
        if (stage === "slash") lens = 68;
      } else {
        boss.getCinematicBounds(bounds);
        bounds.getCenter(focus);
        focus.lerp(p.clone().add(new THREE.Vector3(0, 1, 0)), 0.2);
        desired = focus.clone().addScaledVector(rear, 10 * portrait)
          .addScaledVector(right, 8).add(new THREE.Vector3(0, 3.5, 0));
      }
      if (waiting() && !reducedMotion) {
        desired.addScaledVector(right, Math.sin(clock * 0.38) * 0.6)
          .addScaledVector(rear, -Math.min(clock, 5) * 0.12);
        desired.y += Math.sin(clock * 0.45) * 0.08;
        focus.addScaledVector(right, Math.sin(clock * 0.3) * 0.06);
      }
      const impact = stage === "slash" && clock >= 0.72 && clock < 1.15;
      const blend = 1 - Math.exp(-Math.max(0, dt) * (impact ? 12 : stage === "shot" ? 10 : 5));
      cameraPosition.lerp(resolveCamera(focus, desired), blend);
      cameraFocus.lerp(focus, blend);
      camera.position.copy(cameraPosition);
      camera.lookAt(cameraFocus);
      if (!reducedMotion && stage === "slash" && clock >= 0.8) {
        const shake = Math.exp(-(clock - 0.8) * 13) * 0.22;
        camera.position.addScaledVector(right, Math.sin(clock * 93) * shake);
        camera.position.y += Math.sin(clock * 71) * shake * 0.45;
        camera.rotateZ(Math.sin((clock - 0.8) * Math.PI / 0.7) * 0.035);
      }
      camera.fov = THREE.MathUtils.damp(camera.fov, lens, impact ? 12 : 5, dt);
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      active = false;
      events.abort();
      hide();
      prompt.classList.remove("letter-prompt", "urgent");
      if (original.style === null) prompt.removeAttribute("style");
      else prompt.setAttribute("style", original.style);
      if (original.captionStyle === null) caption.removeAttribute("style");
      else caption.setAttribute("style", original.captionStyle);
      caption.textContent = original.caption;
      label.textContent = original.label;
      hint.textContent = original.hint;
      key.innerHTML = original.key;
      if (original.aria === null) prompt.removeAttribute("aria-label");
      else prompt.setAttribute("aria-label", original.aria);
      for (const element of [key, hint])
        for (const name of ["inputHint", "inputContext", "inputDialogue", "inputRendered"])
          delete element.dataset[name];
      prompt.classList.add("hidden");
      flash.remove();
      trail.dispose();
      beam.removeFromParent();
      beamGeometry.dispose();
      beamMaterial.dispose();
      wave.removeFromParent();
      waveGeometry.dispose();
      waveMaterial.dispose();
      waveCoreMaterial.dispose();
      disposeGun();
      actor = null;
    },
  };
}
