import * as THREE from "three";
import { loadToolModel } from "../../core/loader.js";
import { playLandingSound, playSfx } from "../../helpers/audio/sfx.js";
import type { CinematicPose } from "../player/characterManager.js";
import type { Player } from "../player/player.js";
import { renderDirectionalPrompt } from "../player/directionalPrompt.js";
import { renderControllerPrompt } from "../player/controllerIcons.js";
import { setInputHint } from "../global/inputPrompts.js";
import { createWardenCinematicRig, type WardenRigBeat } from "./wardenCinematicRig.js";
import { MELEE_STRIKES, swordClipTime } from "../global/finaleChoreography.js";
import { isControllerActive } from "../player/gamepadInput.js";
import type { createLoadingBayBoss } from "./mechBaymaxBoss.js";
import { createBladeTrail } from "../level-3/finaleEffects.js";

type Stage = "arrival" | "target" | "aim" | "shoot" | "shot" | "fall" | "mount" | "jump" | "draw" | "cut" | "slash";
const SLASH_IMPACT = 1.38;
export const WARDEN_SLICE_HANDOFF = 1.75 - SLASH_IMPACT;
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
  const promptPanel = document.getElementById("escape-qte");
  if (!promptPanel) throw new Error("The shared hangar QTE panel is missing");
  const prompt = promptPanel;
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
    cue = mode;
    prompt.classList.remove("hidden");
    prompt.classList.add("letter-prompt");
    prompt.style.pointerEvents = teleport ? "none" : "auto";
    prompt.style.opacity = "1";
    key.hidden = teleport;
    key.classList.toggle("hidden", teleport);
    if (teleport) {
      caption.style.cssText = "position:static;width:auto;height:auto;overflow:visible;clip-path:none;margin-bottom:4px;font:400 clamp(16px,2vw,24px)/1.3 var(--comic-display);color:var(--comic-ink)";
      renderControllerPrompt(caption, code === "KeyQ"
        ? isControllerActive() ? "Press D-pad Right to throw" : "Hold Q + left-click"
        : isControllerActive() ? "Press D-pad Up" : "Press T");
    } else {
      if (original.captionStyle === null) caption.removeAttribute("style");
      else caption.setAttribute("style", original.captionStyle);
      caption.textContent = word;
      renderDirectionalPrompt(key, [code], "escape");
    }
    setInputHint(label, text, teleport ? "foot" : "escape");
    setInputHint(hint, teleport
      ? isControllerActive()
        ? "Tap D-pad Right to throw, or hold and release for a longer throw. D-pad Up teleports."
        : "Hold Q to charge. Left-click while holding Q to throw. Press T to teleport."
      : "Y: shoot the core. U: push off the wall. I: split the Warden.", teleport ? "foot" : "escape");
    instruction(text);
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
  const muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3, 1), toneMapped: false }));
  muzzleFlash.visible = false;
  scene.add(muzzleFlash);
  const waveGeometry = new THREE.PlaneGeometry(0.018, 4);
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
  const shieldGeometry = new THREE.IcosahedronGeometry(1, 2);
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe639, transparent: true, opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  const shieldLatticeMaterial = shieldMaterial.clone();
  shieldLatticeMaterial.color.setHex(0xfff3a5);
  shieldLatticeMaterial.wireframe = true;
  const shield = new THREE.Group();
  shield.name = "PrimeWallPropulsionShield";
  shield.visible = false;
  shield.userData.minimap = false;
  shield.userData.preserveComicAppearance = true;
  shield.add(new THREE.Mesh(shieldGeometry, shieldMaterial),
    new THREE.Mesh(shieldGeometry, shieldLatticeMaterial));
  scene.add(shield);
  const wall = new THREE.Vector3(), forward = new THREE.Vector3(), wallStart = new THREE.Vector3();
  const wallFacing = new THREE.Vector3();
  let rig: ReturnType<typeof createWardenCinematicRig> | null = null;
  let rigModel: THREE.Object3D | null = null, rigApplied = false;
  const weaponVisibility = new Map<THREE.Object3D, boolean>();
  let cameraShot = "", cameraAge = 0;
  let landingHit = false;
  const cutLine = { normal: new THREE.Vector2(1, 0), offset: 0.5 };
  const cutPoint = new THREE.Vector2(0.5, 0.5);
  let cutAngle = 0, cutLineReady = false;
  const blockedKeys = new Set<string>();
  const start = new THREE.Vector3(), mount = new THREE.Vector3(),
    target = new THREE.Vector3(), focus = new THREE.Vector3(),
    cameraPosition = new THREE.Vector3(), cameraFocus = new THREE.Vector3(),
    muzzle = new THREE.Vector3();
  const bounds = new THREE.Box3();
  const events = new AbortController();
  let active = false, disposed = false, paused = false, inputReady = false, clock = 0,
    stage: Stage = "arrival", impact = false, actor: Actor | null = null,
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
    return stage === "shoot" || (stage === "mount" && clock >= 0.5) || (stage === "cut" && clock >= 0.6);
  }
  function restoreRig() {
    if (rigApplied) rig?.restore();
    rigApplied = false;
    for (const [weapon, visible] of weaponVisibility) weapon.visible = visible;
    weaponVisibility.clear();
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
    muzzleFlash.visible = false;
    wave.visible = false;
    shield.visible = false;
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
  window.addEventListener("keyup", (event) => blockedKeys.delete(event.code), { signal: events.signal });
  window.addEventListener("keydown", (event) => {
    if (!["KeyY", "KeyU", "KeyI"].includes(event.code)) return;
    if (!active || !inputReady || hidden() || event.repeat || !waiting()) {
      blockedKeys.add(event.code);
      return;
    }
    if (blockedKeys.has(event.code)) return;
    if (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, dialog, [contenteditable="true"]')) return;
    if (!["KeyY", "KeyU", "KeyI"].includes(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === expected()) accept();
    else {
      active = false;
      hide();
      restoreRig();
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
    cue = "";
    if (nextStage === "slash") cutLineReady = false;
    prompt.classList.add("hidden");
  }
  return {
    ready,
    get active() { return active; },
    get stage() { return stage; },
    start() {
      if (disposed || !boss.beginFinisher()) return false;
      hide();
      active = true;
      landingHit = false;
      next("arrival");
      boss.getRootPosition(start);
      const rear = new THREE.Vector3(-Math.sin(boss.getYaw()), 0, -Math.cos(boss.getYaw()));
      const tx = Math.abs(rear.x) < 1e-5 ? Infinity : ((rear.x > 0 ? 19.65 : -19.65) - start.x) / rear.x;
      const tz = Math.abs(rear.z) < 1e-5 ? Infinity : ((rear.z > 0 ? 23.65 : -23.65) - start.z) / rear.z;
      wall.copy(start).addScaledVector(rear, Math.min(tx, tz));
      wall.y = THREE.MathUtils.clamp(player.body.position.y - player.radius, 4.6, 7);
      forward.set(tx < tz ? -Math.sign(rear.x) : 0, 0, tz <= tx ? -Math.sign(rear.z) : 0);
      wallFacing.copy(forward);
      wallStart.copy(wall).addScaledVector(forward, 0.85);
      wallStart.y += player.radius;
      player.setPosition(wallStart.x, wallStart.y, wallStart.z);
      player.setRotation(Math.atan2(-forward.x, -forward.z), 0);
      cameraShot = "";
      start.copy(wallStart);
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
      restoreRig();
    },
    teleportCue(mode: "hold" | "charging" | "flight" | "teleport" | "recharging" | null, progress = 0) {
      if (active) return;
      if (!mode || hidden()) {
        hide();
        return;
      }
      const teleport = mode === "teleport" || mode === "flight";
      const text = teleport
        ? mode === "flight"
          ? "Let the crystal land, then press T."
          : "Press T. Teleport behind him."
        : mode === "recharging"
          ? "Let the crystal recharge."
          : isControllerActive()
            ? "Aim behind him, then use D-pad Right to throw."
            : "Hold Q and left-click to throw. Aim behind him first.";
      present(`teleport-${mode}`, teleport ? "KeyT" : "KeyQ",
        teleport ? "PRESS" : "HOLD", text, true);
      prompt.style.pointerEvents = "none";
      prompt.classList.remove("urgent");
      prompt.style.setProperty("--qte-pulse", String(progress));
      prompt.style.opacity = mode === "recharging" || mode === "flight" ? "0.65" : "1";
      fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    },
    get sliceAge() { return active && stage === "slash" ? clock - SLASH_IMPACT : -1; },
    get cutLine() { return cutLine; },
    get bloomTargets() {
      return [...(wave.visible ? [wave] : []),
        ...(muzzleFlash.visible ? [muzzleFlash] : [])];
    },
    get bloomPulse() { return reducedMotion ? 0 : wave.visible ? 0.85 : 0; },
    update(dt: number) {
      if (!active || hidden()) return;
      frameDelta = dt;
      clock += dt;
      if (stage !== "fall" && stage !== "mount") boss.getBackWorldPosition(target);
      if (waiting()) {
        inputReady = true;
        const elapsed = clock - (stage === "mount" ? 0.5 : stage === "cut" ? 0.6 : 0);
        present(stage, expected(), "PRESS THE DISPLAYED BUTTON",
          stage === "shoot" ? "Shoot the blue core on his back."
            : stage === "mount" ? "Prime's shield will launch you. Land on his back." : "One clean cut. Split the frame.");
        prompt.classList.toggle("urgent", elapsed >= 3.5);
        prompt.style.setProperty("--qte-pulse", String(Math.max(0, Math.sin(elapsed * 6)) * elapsed / 5));
        fill.style.width = `${Math.max(0, 1 - elapsed / 5) * 100}%`;
        if (elapsed >= 5) {
          active = false;
          hide();
          restoreRig();
          onFailure();
          return;
        }
      }
      beam.visible = stage === "shot" && clock < 0.22;
      muzzleFlash.visible = stage === "shot" && clock < 0.1 && !reducedMotion;
      if (["arrival", "target", "aim", "shoot", "shot", "fall", "mount"].includes(stage)) {
        player.setPosition(wallStart.x, wallStart.y + Math.sin(clock * 1.6) * 0.06, wallStart.z);
      }
      shield.visible = stage === "jump" && clock < 0.7;
      if (shield.visible) {
        const pulse = THREE.MathUtils.smootherstep(clock, 0, 0.42);
        shield.position.copy(wallStart);
        shield.position.y += 0.55;
        shield.position.addScaledVector(wallFacing, -0.45);
        shield.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wallFacing);
        shield.scale.set(0.65 + pulse * 0.55, 1 + pulse * 0.4, 0.16 + pulse * 0.12);
        const fade = 1 - THREE.MathUtils.smoothstep(clock, 0.42, 0.7);
        shieldMaterial.opacity = (reducedMotion ? 0.06 : 0.08 + pulse * 0.06) * fade;
        shieldLatticeMaterial.opacity = 0.22 * fade;
      }
      if (stage === "arrival" && clock >= 1.15) next("target");
      else if (stage === "target" && clock >= 0.6) next("aim");
      else if (stage === "aim" && clock >= 0.7) next("shoot");
      else if (stage === "shot") {
        if (!impact && clock >= 0.08) {
          impact = true;
          boss.shootFinisherCore();
        }
        if (clock >= 0.65) next("fall");
      } else if (stage === "fall") {
        boss.setFinisherDrop(THREE.MathUtils.smootherstep(clock, 0, 2.2));
        if (clock >= 2.2) {
          boss.getCinematicBounds(bounds);
          bounds.getCenter(mount);
          mount.y = bounds.max.y + player.radius + 0.04;
          next("mount");
        }
      } else if (stage === "jump") {
        const p = THREE.MathUtils.clamp((clock - 0.42) / 1.15, 0, 1);
        const at = start.clone().lerp(mount, p);
        at.y += Math.sin(p * Math.PI) * 1.2;
        player.setPosition(at.x, at.y, at.z);
        const turn = THREE.MathUtils.smootherstep(clock, 0.75, 1.57);
        const yawStart = Math.atan2(wallFacing.x, wallFacing.z);
        const yawDelta = Math.atan2(Math.sin(boss.getYaw() - yawStart), Math.cos(boss.getYaw() - yawStart));
        forward.set(Math.sin(yawStart + yawDelta * turn), 0, Math.cos(yawStart + yawDelta * turn));
        player.setRotation(yawStart + yawDelta * turn + Math.PI, 0);
        if (!landingHit && clock >= 1.57) {
          landingHit = true;
          playLandingSound(13, 0.85);
        }
        if (clock >= 2.12) next("draw");
      } else if (stage === "draw" && clock >= 0.6) {
        next("cut");
      } else if (stage === "slash") {
        if (!impact && clock >= SLASH_IMPACT) {
          impact = true;
          playSfx("slash", 1);
        }
        if (clock >= 1.75) {
          active = false;
          hide();
          onComplete();
        }
      }
    },
    pose(): CinematicPose {
      if (active && (stage === "draw" || stage === "cut")) return { clip: "Sword_Idle", time: clock, loop: true };
      if (active && stage === "slash") return {
        clip: "Sword_Regular_C",
        time: swordClipTime(clock, MELEE_STRIKES.cleave.duration, MELEE_STRIKES.cleave,
          { duration: 1.75, start: 1.12, end: SLASH_IMPACT }),
        duration: MELEE_STRIKES.cleave.duration,
        loop: false,
      };
      return { clip: "Idle_Loop", time: clock, loop: true };
    },
    character(value: Actor | null, landingTime = -1) {
      actor = value;
      if (!actor) return;
      if (!active && (landingTime < 0 || landingTime >= 1.7)) { restoreRig(); return; }
      if (rigModel !== actor.model) {
        restoreRig();
        rigModel = actor.model;
        rig = createWardenCinematicRig(actor.model);
      }
      const sword = actor.model.getObjectByName("bloomstick");
      const socket = actor.weapon?.socket;
      for (const weapon of [sword, socket, actor.model.getObjectByName("crowbar")]) {
        if (!weapon) continue;
        if (!weaponVisibility.has(weapon)) weaponVisibility.set(weapon, weapon.visible);
        weapon.visible = false;
      }
      const gunVisible = active && ["arrival", "target", "aim", "shoot", "shot", "fall", "mount"].includes(stage);
      if (gunVisible && gun && socket) {
        socket.visible = true;
        socket.add(gun);
        gun.position.set(0, 0.02, 0);
        gun.visible = true;
      } else gun?.removeFromParent();
      let beat: WardenRigBeat = "wall", sample = clock;
      if (landingTime >= 0) {
        beat = landingTime < 1.15 ? "flight" : "land";
        sample = landingTime < 1.15 ? landingTime : landingTime - 1.15;
      } else if (["aim", "shoot", "fall", "mount"].includes(stage)) {
        beat = "aim";
        sample = stage === "aim" ? clock : 1;
      } else if (stage === "shot") beat = "recoil";
      else if (stage === "jump") {
        beat = clock < 0.42 ? "push" : clock < 1.57 ? "flight" : "land";
        sample = clock < 0.42 ? clock : clock < 1.57 ? clock - 0.42 : clock - 1.57;
      }
      const feet = new THREE.Vector3().copy(player.body.position).add(new THREE.Vector3(0, -player.radius, 0));
      if (active && ["arrival", "target", "draw", "cut", "slash"].includes(stage)) {
        rig?.release();
        if (stage === "draw") rig?.drawSword(feet, forward, clock);
        rigApplied = false;
      } else {
        const facing = landingTime >= 0
          ? new THREE.Vector3(-Math.sin(player.getState().yaw), 0, -Math.cos(player.getState().yaw)) : forward;
        rig?.apply({ beat, time: sample, delta: hidden() ? 0 : frameDelta,
          feet, forward: facing, wall, target, socket });
        rigApplied = true;
      }
      if (gunVisible && socket) {
        muzzle.copy(socket.localToWorld(new THREE.Vector3(0, 0.12, -0.38)));
        beam.geometry.setFromPoints([muzzle, target]);
        muzzleFlash.position.copy(muzzle);
      }
      if (sword && active && ((stage === "draw" && clock >= 0.18) || stage === "cut" || stage === "slash")) {
        sword.visible = true;
        sword.updateWorldMatrix(true, true);
        sword.localToWorld(bladeBase.set(0, 0.32, 0));
        sword.localToWorld(bladeTip.set(0, 1.22, 0));
        trail.update(bladeBase, bladeTip, frameDelta, stage === "slash" && clock >= 1.12, 1);
      }
    },
    camera(dt: number) {
      if (!active || hidden()) return;
      const p = new THREE.Vector3().copy(player.body.position);
      const shotForward = stage === "draw" || stage === "cut" || stage === "slash" ? forward : wallFacing;
      const right = new THREE.Vector3().crossVectors(shotForward, new THREE.Vector3(0, 1, 0));
      const portrait = Math.max(1, 1.2 / camera.aspect);
      let lens = 52, shot = "gun", desired: THREE.Vector3;
      if (stage === "arrival") {
        shot = "wall";
        focus.copy(p).add(new THREE.Vector3(0, 0.65, 0));
        desired = focus.clone().addScaledVector(forward, 5 * portrait).addScaledVector(right, 3);
      } else if (stage === "target") {
        shot = "target";
        boss.getBackWorldPosition(focus);
        desired = focus.clone().addScaledVector(forward, -3 * portrait).addScaledVector(right, 0.8);
        lens = 40;
      } else if (stage === "fall") {
        shot = "collapse";
        boss.getCinematicBounds(bounds);
        bounds.getCenter(focus).lerp(wallStart, 0.35);
        desired = boss.getRootPosition().add(new THREE.Vector3(Math.sin(boss.getYaw()) * 14, 6.5, Math.cos(boss.getYaw()) * 14));
        desired.addScaledVector(right, 3);
        if (!reducedMotion) desired.y -= 1.3 * THREE.MathUtils.smootherstep(clock, 0, 2.2);
        lens = 62;
      } else if (stage === "mount" || stage === "jump") {
        shot = "launch";
        focus.copy(wallStart).lerp(mount, 0.5);
        const tracking = stage === "jump" && !reducedMotion ? THREE.MathUtils.smootherstep(clock, 0.35, 1.15) : 0;
        focus.lerp(p, tracking * 0.65);
        const distance = Math.max(6, wallStart.distanceTo(mount) * (0.85 - tracking * 0.25)) * portrait;
        desired = focus.clone().addScaledVector(right, distance).addScaledVector(wallFacing, 1.5);
        desired.y += 1.6;
        lens = 62;
      } else if (stage === "draw" || stage === "cut" || stage === "slash") {
        shot = "blade";
        focus.copy(p).add(new THREE.Vector3(0, 0.9, 0));
        if (stage === "slash") focus.lerp(bladeBase.clone().lerp(bladeTip, 0.5),
          THREE.MathUtils.smootherstep(clock, 1.05, SLASH_IMPACT) * 0.8);
        desired = p.clone().addScaledVector(forward, 2.3 * portrait);
        desired.y -= 1.2;
        lens = 66;
      } else {
        const barrel = actor?.weapon?.socket
          ? actor.weapon.socket.localToWorld(new THREE.Vector3(0, 0.12, -0.38))
          : p.clone().add(new THREE.Vector3(0, 0.9, 0));
        const firingLine = target.clone().sub(barrel).normalize();
        focus.copy(barrel).lerp(target, 0.65);
        desired = barrel.clone().addScaledVector(firingLine, -0.85 * portrait)
          .addScaledVector(right, 0.5).add(new THREE.Vector3(0, 0.28, 0));
        lens = 60;
      }
      const cut = cameraShot !== shot;
      cameraAge = cut ? 0 : cameraAge + dt;
      cameraShot = shot;
      if (!reducedMotion) {
        const move = cameraAge;
        const offset = desired.clone().sub(focus);
        const arc = shot === "blade" ? 0.045 : shot === "wall" ? -0.17 : shot === "gun" ? 0.018 : 0.055;
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(move * 0.65) * arc);
        offset.multiplyScalar(1 - Math.sin(move * 0.42) * (shot === "gun" ? 0.035 : 0.12));
        desired.copy(focus).add(offset);
        lens -= Math.sin(move * 0.5) * (shot === "blade" ? 4 : 2);
        desired.addScaledVector(right, Math.sin(move * 0.9) * (shot === "gun" ? 0.08 : 0.28));
        desired.y += Math.sin(move * 0.75) * 0.16;
        if (stage === "shot") desired.addScaledVector(right, Math.sin(clock * 65) * Math.exp(-clock * 12) * 0.09);
        if (stage === "jump" && clock >= 1.57) {
          const hit = Math.exp(-(clock - 1.57) * 11);
          desired.y += Math.sin((clock - 1.57) * 48) * hit * 0.16;
        }
      }
      const blend = cut ? 1 : 1 - Math.exp(-Math.max(0, dt) * 5);
      cameraPosition.lerp(resolveCamera(focus, desired), blend);
      cameraFocus.lerp(focus, blend);
      camera.position.copy(cameraPosition);
      camera.lookAt(cameraFocus);
      if (!reducedMotion) camera.rotateZ(
        (shot === "gun" ? -0.1 : shot === "wall" ? 0.09 : shot === "launch" ? -0.055 : 0) +
        Math.sin(cameraAge * 0.85) * 0.022);
      camera.fov = cut ? lens : THREE.MathUtils.damp(camera.fov, lens, 5, dt);
      camera.updateProjectionMatrix();
      const slashAge = stage === "slash" ? clock - SLASH_IMPACT : -1;
      wave.visible = slashAge >= 0 && slashAge < WARDEN_SLICE_HANDOFF;
      if (wave.visible) {
        camera.updateMatrixWorld(true);
        if (!cutLineReady) {
          const a = bladeBase.clone().project(camera);
          const b = bladeTip.clone().project(camera);
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx * dx + dy * dy > 1e-6) {
            cutLine.normal.set(-dy, dx).normalize();
            cutLine.offset = cutLine.normal.dot(new THREE.Vector2(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5));
            cutAngle = Math.atan2(dy, dx * camera.aspect) - Math.PI / 2;
          } else {
            cutLine.normal.set(1, 0);
            cutLine.offset = 0.5;
            cutAngle = 0;
          }
          cutPoint.set(0.5, 0.5).addScaledVector(cutLine.normal,
            cutLine.offset - cutLine.normal.dot(new THREE.Vector2(0.5, 0.5)));
          cutLineReady = true;
        }
        const height = 4 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.getWorldDirection(wave.position).multiplyScalar(2).add(camera.position);
        wave.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), (cutPoint.x - 0.5) * height * camera.aspect)
          .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), (cutPoint.y - 0.5) * height);
        wave.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), cutAngle));
        const decay = 1 - THREE.MathUtils.smoothstep(slashAge, 0.05, WARDEN_SLICE_HANDOFF);
        wave.scale.set(reducedMotion ? 1 : 1 + Math.sin(slashAge * 34) * 0.6 + slashAge * 10,
          height * Math.max(1, camera.aspect), 1);
        waveMaterial.opacity = reducedMotion ? 0.3 : 0.9 * decay;
        waveCoreMaterial.opacity = decay;
        waveCoreMaterial.color.setRGB(4, 5, 6);
      }
    },
    dispose() {
      disposed = true;
      active = false;
      events.abort();
      hide();
      restoreRig();
      key.hidden = false;
      key.classList.remove("hidden");
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
      for (const element of [key, hint, label, caption])
        for (const name of ["inputHint", "inputContext", "inputDialogue", "inputRendered", "controllerPrompt", "controllerRendered", "directionPrompt"])
          delete element.dataset[name];
      prompt.classList.add("hidden");
      flash.remove();
      trail.dispose();
      beam.removeFromParent();
      beamGeometry.dispose();
      beamMaterial.dispose();
      muzzleFlash.removeFromParent();
      muzzleFlash.geometry.dispose();
      muzzleFlash.material.dispose();
      wave.removeFromParent();
      waveGeometry.dispose();
      waveMaterial.dispose();
      waveCoreMaterial.dispose();
      shield.removeFromParent();
      shieldGeometry.dispose();
      shieldMaterial.dispose();
      shieldLatticeMaterial.dispose();
      disposeGun();
      actor = null;
    },
  };
}
