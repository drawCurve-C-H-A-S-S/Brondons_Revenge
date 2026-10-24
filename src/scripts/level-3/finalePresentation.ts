import {
  getAudioSettings,
  getSfxGain,
  subscribeAudioSettings,
} from "../../helpers/audio/AudioManager.js";
import { playSfx } from "../../helpers/audio/sfx.js";
import { DUEL } from "../npc/mechDuel.js";
import { FINALE_DURATION } from "../global/finaleDirector.js";
import { createComicEffectArtwork } from "../global/comicEffects.js";
import { isControllerActive, inputHint } from "../player/gamepadInput.js";
import { setInputHint } from "../global/inputPrompts.js";
import { renderDirectionalPrompt } from "../player/directionalPrompt.js";

export function createFinalePresentation(
  onInput: (code: string, pressed: boolean) => void,
  onRetry: () => void,
) {
  const root = document.createElement("section");
  root.className = "finale-hud";
  root.setAttribute("aria-label", "Final boss fight");
  root.innerHTML = `<div class="finale-letterbox top"></div><div class="finale-letterbox bottom"></div>
    <header class="finale-objective"><span>FINAL CHAPTER</span><strong></strong><small></small></header>
    <button type="button" class="scene-dialogue-skip finale-skip hidden">Hold Enter to skip</button>
    <div class="finale-speed-lines" aria-hidden="true"></div>
    <section class="finale-player-status" aria-label="Prime Frame status">
      <div class="finale-status-heading"><strong>BRONDON</strong><span class="finale-health-value">1000 / 1000</span></div>
      <meter class="finale-integrity" min="0" max="1000" value="1000" aria-label="Prime Frame integrity"></meter>
    </section>
    <nav class="finale-controls" aria-label="Combat controls">
      <div class="finale-control-group finale-control-movement">
        <span class="finale-control ready" data-control="left" aria-label="Move left"><kbd data-input-key="KeyA">A</kbd><small><b>←</b></small></span>
        <span class="finale-control ready" data-control="right" aria-label="Move right"><kbd data-input-key="KeyD">D</kbd><small><b>→</b></small></span>
        <span class="finale-control finale-orbit-controls ready" data-control="rise" aria-label="Rise"><kbd data-input-key="KeyW">W</kbd><small><b>↑</b></small></span>
        <span class="finale-control finale-orbit-controls ready" data-control="dive" aria-label="Dive"><kbd data-input-key="KeyS">S</kbd><small><b>↓</b></small></span>
      </div>
      <div class="finale-control-group finale-control-actions">
        <span class="finale-control ready" data-control="swing"><kbd data-input-key="KeyJ">J</kbd><small><b>BLADE</b></small></span>
        <span class="finale-control ready" data-control="dodge"><kbd data-input-key="Space">SPACE</kbd><small><b>DODGE</b></small></span>
        <span class="finale-control ready" data-control="slide"><kbd data-input-key="KeyC">C</kbd><small><b>SLIDE</b></small></span>
      </div>
      <div class="finale-control-group finale-control-systems">
        <span class="finale-control finale-control-charge ready" data-control="rifle"><kbd data-input-key="KeyF">F</kbd><small><b>RIFLE</b><em>READY</em></small></span>
        <span class="finale-control finale-control-charge ready" data-control="guard"><kbd data-input-key="KeyR">R</kbd><small><b>SHIELD</b><em>READY</em></small></span>
        <span class="finale-control finale-control-charge ready" data-control="special"><kbd data-input-key="KeyE">E</kbd><small><b>LAST LIGHT</b><em>READY</em></small></span>
      </div>
    </nav>
    <div class="finale-tell" role="status" aria-live="polite"></div><div class="finale-title" aria-live="polite"></div>
    <section class="finale-dialogue" aria-live="polite"><b></b><p></p></section>
    <div class="finale-flash" aria-hidden="true"></div>
    <section class="finale-result" aria-live="assertive" hidden>
      <span></span><h1></h1><p></p><button type="button">RETRY LAST CHECKPOINT</button>
    </section>
    <section class="finale-credits" aria-label="Credits" hidden>
      <div class="finale-credits-roll"></div>
    </section>
    <nav class="finale-touch" aria-label="Mech controls">
      <div class="finale-touch-movement">
        <button data-key="KeyA" aria-label="Move left">LEFT</button><button data-key="KeyD" aria-label="Move right">RIGHT</button>
        <button data-key="KeyW" aria-label="Up attack direction; rise in space">UP</button>
        <button data-key="KeyS" aria-label="Down attack direction; dive in space">DOWN</button>
      </div>
      <div class="finale-touch-actions">
        <button data-key="Space" aria-label="Boost">BOOST</button><button data-key="KeyJ" aria-label="Sword attack">SWORD</button>
        <button data-key="KeyR" aria-label="Hold to raise the shield">SHIELD</button><button data-key="KeyF" aria-label="Draw the rifle and fire a salvo">RIFLE</button>
        <button data-key="KeyE" aria-label="Blade-wave ultimate">ULTIMATE</button>
        <button data-key="KeyC" aria-label="Grounded slide tackle">SLIDE</button>
      </div>
    </nav>`;
  document.body.appendChild(root);
  document.body.classList.add("finale-active");

  const get = <T extends Element = HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Finale presentation is missing ${selector}`);
    return element;
  };
  const objective = get(".finale-objective strong");
  const hint = get(".finale-objective small");
  const playerStatus = get(".finale-player-status");
  const heroBar = get<HTMLMeterElement>(".finale-integrity");
  const healthValue = get(".finale-health-value");
  const controls = get(".finale-controls");
  const rifleControl = get<HTMLElement>(
    '.finale-control[data-control="rifle"]',
  );
  const guardControl = get<HTMLElement>(
    '.finale-control[data-control="guard"]',
  );
  const specialControl = get<HTMLElement>(
    '.finale-control[data-control="special"]',
  );
  const rifleState = get<HTMLElement>(
    '.finale-control[data-control="rifle"] em',
  );
  const guardState = get<HTMLElement>(
    '.finale-control[data-control="guard"] em',
  );
  const specialState = get<HTMLElement>(
    '.finale-control[data-control="special"] em',
  );
  const rifleTouch = get<HTMLElement>('.finale-touch [data-key="KeyF"]');
  const guardTouch = get<HTMLElement>('.finale-touch [data-key="KeyR"]');
  const specialTouch = get<HTMLElement>('.finale-touch [data-key="KeyE"]');
  let objectiveHint = "";
  function updateInputLabels() {
    for (const key of root.querySelectorAll<HTMLElement>(
      "kbd[data-input-key]",
    )) {
      const code = key.dataset.inputKey!;
      renderDirectionalPrompt(key, [code], "finale");
    }
    hint.textContent = inputHint(objectiveHint, "finale");
  }
  const bossHud = document.getElementById("boss-hud");
  const bossLabel = document.getElementById("boss-health-label");
  const bossFill = document.getElementById("boss-health-fill");
  if (!bossHud || !bossLabel || !bossFill)
    throw new Error("The shared boss health bar is missing from the finale.");
  const title = get(".finale-title");
  const skipButton = get<HTMLButtonElement>(".finale-skip");
  const boom = document.createElement("img");
  boom.src = createComicEffectArtwork("boom").toDataURL();
  boom.alt = "BOOM!";
  boom.style.width = "clamp(6rem, 16vw, 12rem)";
  boom.style.maxWidth = "24vw";
  const dialogue = get(".finale-dialogue");
  const speaker = get(".finale-dialogue b");
  const line = get(".finale-dialogue p");
  const tell = get(".finale-tell");
  const result = get(".finale-result");
  const retry = get<HTMLButtonElement>(".finale-result button");
  const credits = get(".finale-credits");
  const roll = get(".finale-credits-roll");
  const events = new AbortController();
  let muted = false,
    audioContext: AudioContext | null = null;
  const activeOscillators = new Set<OscillatorNode>();
  const heldPointers = new Map<number, string>();
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let flashPower = 0;

  roll.innerHTML =
    document.getElementById("credits-content")?.innerHTML ??
    "<h1>BRONDON'S REVENGE</h1><p>Created by CHASS</p><p>Thank you for playing.</p>";
  retry.addEventListener("click", onRetry, { signal: events.signal });

  function press(event: PointerEvent, code: string, button: HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    button.setPointerCapture(event.pointerId);
    heldPointers.set(event.pointerId, code);
    onInput(code, true);
  }
  function release(event: PointerEvent) {
    const code = heldPointers.get(event.pointerId);
    if (!code) return;
    onInput(code, false);
    heldPointers.delete(event.pointerId);
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-key]")) {
    button.type = "button";
    button.addEventListener(
      "pointerdown",
      (event) => press(event, button.dataset.key ?? "", button),
      { signal: events.signal },
    );
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(type, (event) => release(event as PointerEvent), {
        signal: events.signal,
      });
    }
  }
  function clearPointers() {
    for (const code of heldPointers.values()) onInput(code, false);
    heldPointers.clear();
  }
  window.addEventListener("blur", clearPointers, { signal: events.signal });

  const settingsOff = subscribeAudioSettings((settings) => {
    if (!settings.paused) return;
    for (const oscillator of activeOscillators) {
      try {
        oscillator.stop();
      } catch {
        /* The oscillator has already ended. */
      }
    }
    activeOscillators.clear();
  });
  function unlockAudio() {
    if (typeof AudioContext === "undefined") return;
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      void audioContext
        .resume()
        .catch((error) =>
          console.warn("[Finale] Audio could not be resumed:", error),
        );
    }
  }
  window.addEventListener("pointerdown", unlockAudio, {
    signal: events.signal,
  });
  window.addEventListener("keydown", unlockAudio, { signal: events.signal });

  return {
    root,
    skipButton,
    mode(phase: string, cinematic: boolean, mech: boolean) {
      root.dataset.phase = phase;
      root.classList.toggle("cinematic", cinematic);
      root.classList.toggle("mech", mech);
      root.classList.toggle("finale-finishing", phase === "finisher");
      skipButton.classList.toggle(
        "hidden",
        phase !== "reveal" &&
          phase !== "enemyTransform" &&
          phase !== "heroTransform",
      );
      playerStatus.hidden = !mech || cinematic;
      controls.hidden = !mech || cinematic;
      bossHud.classList.toggle("hidden", !mech);
      if (mech) {
        bossLabel.textContent = "SUDOERS 5";
        bossHud.setAttribute("aria-label", "Sudoers 5 / Final Verdict health");
        bossFill.setAttribute("aria-valuemin", "0");
        bossFill.setAttribute("aria-valuemax", String(DUEL.health));
      }
      get(".finale-touch").hidden =
        cinematic ||
        isControllerActive() ||
        !document.body.classList.contains("touch-device");
    },
    objective(text: string, controlHint: string) {
      objective.textContent = text;
      objectiveHint = controlHint;
      hint.textContent = inputHint(controlHint, "finale");
    },
    title(text: string) {
      if (title.dataset.word === text) return;
      if (text === "BOOM!") title.replaceChildren(boom);
      else title.textContent = text;
      title.dataset.word = text;
      title.hidden = !text;
    },
    dialogue(name: string, text: string) {
      speaker.textContent = name;
      setInputHint(line, text, "finale", true);
      dialogue.dataset.speaker = name;
      dialogue.hidden = !text;
    },
    stats(
      hp: number,
      enemyHp: number,
      power: number,
      shield: number,
      cooldown: number,
      warning: string,
      shieldLock = 0,
      immunityRemaining = 0,
    ) {
      heroBar.value = Math.max(0, Math.min(1000, hp));
      playerStatus.dataset.health =
        hp <= DUEL.heroHealth * 0.25
          ? "low"
          : hp <= DUEL.heroHealth * 0.5
            ? "mid"
            : "high";
      bossFill.style.width = `${Math.max(0, Math.min(100, (enemyHp / DUEL.health) * 100))}%`;
      bossFill.setAttribute(
        "aria-valuenow",
        String(Math.max(0, Math.min(DUEL.health, enemyHp))),
      );
      healthValue.textContent = `${Math.ceil(hp)} / ${DUEL.heroHealth}`;
      const setCharge = (
        control: HTMLElement,
        touch: HTMLElement,
        state: HTMLElement,
        ratio: number,
        text: string,
        ready: boolean,
      ) => {
        const charge = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
        control.style.setProperty("--charge", charge);
        control.classList.toggle("ready", ready);
        control.classList.toggle("charging", !ready);
        state.textContent = text;
        touch.style.setProperty("--charge", charge);
        touch.classList.toggle("ready", ready);
        touch.classList.toggle("charging", !ready);
        touch.dataset.state = text;
      };
      setCharge(
        rifleControl,
        rifleTouch,
        rifleState,
        power / 100,
        power >= 38 ? "READY" : `${Math.ceil(power)}%`,
        power >= 38,
      );
      if (immunityRemaining > 0) {
        setCharge(
          guardControl,
          guardTouch,
          guardState,
          1,
          `AEGIS ${Math.ceil(immunityRemaining)}s`,
          true,
        );
      } else if (shieldLock > 0) {
        setCharge(
          guardControl,
          guardTouch,
          guardState,
          1 - shieldLock / DUEL.shieldBreak,
          `${Math.ceil(shieldLock)}s`,
          false,
        );
      } else {
        setCharge(
          guardControl,
          guardTouch,
          guardState,
          shield / DUEL.shieldMax,
          shield >= DUEL.shieldMax - 0.5 ? "READY" : `${Math.ceil(shield)}%`,
          shield >= DUEL.shieldMax - 0.5,
        );
      }
      setCharge(
        specialControl,
        specialTouch,
        specialState,
        1 - cooldown / DUEL.ultimateCooldown,
        cooldown > 0 ? `${Math.ceil(cooldown)}s` : "READY",
        cooldown <= 0,
      );
      tell.textContent = warning;
      tell.hidden = !warning;
    },
    flash(amount: number) {
      flashPower = reducedMotion
        ? 0
        : Math.max(flashPower, Math.max(0, Math.min(0.65, amount)));
    },
    speedLines(power: number) {
      get(".finale-speed-lines").style.opacity = String(
        reducedMotion ? 0 : Math.max(0, Math.min(0.42, power)),
      );
    },
    update(dt: number) {
      updateInputLabels();
      flashPower = Math.max(0, flashPower - dt * 2.8);
      get(".finale-flash").style.opacity = String(flashPower);
    },
    result(
      titleText: string,
      description: string,
      canRetry: boolean,
      kicker = "SIGNAL LOST",
    ) {
      result.hidden = !titleText;
      get(".finale-result h1").textContent = titleText;
      get(".finale-result p").textContent = description;
      get(".finale-result span").textContent = kicker;
      retry.hidden = !canRetry;
    },
    credits(time: number) {
      credits.hidden = time < 0;
      const progress = Math.min(1, Math.max(0, time) / FINALE_DURATION.credits);
      const travel =
        window.innerHeight + roll.scrollHeight + window.innerHeight * 0.25;
      roll.style.transform = `translate(-50%, ${window.innerHeight - progress * travel}px)`;
    },
    pause(value: boolean) {
      muted = value;
      clearPointers();
      if (value)
        for (const oscillator of activeOscillators) {
          try {
            oscillator.stop();
          } catch {
            /* The oscillator has already ended. */
          }
        }
      activeOscillators.clear();
    },
    sound(kind: "hit" | "launch" | "parry" | "special" | "qte" | "explode") {
      if (kind === "explode" && !muted && !getAudioSettings().paused)
        playSfx("explosion", 0.9);
      if (
        !audioContext ||
        audioContext.state !== "running" ||
        muted ||
        getAudioSettings().paused ||
        activeOscillators.size >= 12
      )
        return;
      const oscillator = audioContext.createOscillator(),
        gain = audioContext.createGain(),
        now = audioContext.currentTime;
      const frequency = {
        hit: 110,
        launch: 210,
        parry: 840,
        special: 65,
        qte: 660,
        explode: 45,
      }[kind];
      oscillator.type =
        kind === "parry" || kind === "qte" ? "sine" : "sawtooth";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, frequency * 0.25),
        now + 0.3,
      );
      gain.gain.setValueAtTime(0.07 * getSfxGain(), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      activeOscillators.add(oscillator);
      oscillator.onended = () => {
        activeOscillators.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start();
      oscillator.stop(now + 0.36);
    },
    dispose() {
      clearPointers();
      events.abort();
      settingsOff();
      if (audioContext) {
        void audioContext
          .close()
          .catch((error) =>
            console.warn("[Finale] Audio context could not close:", error),
          );
      }
      root.remove();
      document.body.classList.remove("finale-active");
    },
  };
}
