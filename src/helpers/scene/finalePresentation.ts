import { getAudioSettings, subscribeAudioSettings } from '../audio/AudioManager.js';
import { DUEL, type FinaleQteState } from '../../scripts/mechDuel.js';
import { finisherActionTime } from '../../scripts/finaleChoreography.js';
import { FINALE_DURATION } from '../../scripts/finaleDirector.js';
import { createComicEffectArtwork } from './comicEffects.js';

const KEY_LABELS: Record<string, string> = {
  KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyS: 'S', KeyJ: 'J', KeyF: 'F', KeyE: 'E', KeyR: 'R',
  Space: 'SPACE',
};

export function createFinalePresentation(onInput: (code: string, pressed: boolean) => void, onRetry: () => void) {
  const root = document.createElement('section');
  root.className = 'finale-hud';
  root.setAttribute('aria-label', 'Final boss fight');
  root.innerHTML = `<div class="finale-letterbox top"></div><div class="finale-letterbox bottom"></div>
    <header class="finale-objective"><span>FINAL CHAPTER / THE LAST LIGHT</span><strong></strong><small></small></header>
    <button type="button" class="scene-dialogue-skip finale-skip hidden">Hold Enter to skip</button>
    <div class="finale-speed-lines" aria-hidden="true"></div>
    <section class="finale-player-status" aria-label="Prime Frame status">
      <div class="finale-status-heading"><strong>BRONDON</strong><span class="finale-health-value">1000 / 1000</span></div>
      <meter class="finale-integrity" min="0" max="1000" value="1000" aria-label="Prime Frame integrity"></meter>
      <div class="finale-resources"><span class="finale-shield-value">SHIELD 100% / R</span><span class="finale-energy">BOOST 100%</span></div>
      <div class="finale-resource-meters"><meter class="finale-shield-meter" min="0" max="100" value="100" aria-label="Prime Frame shield"></meter>
        <meter class="finale-energy-meter" min="0" max="100" value="100" aria-label="Prime Frame boost and rifle energy"></meter></div>
    </section>
    <aside class="finale-ultimate" aria-label="Blade-wave ultimate">
      <kbd>E</kbd><div><strong>LAST LIGHT</strong><span class="finale-ultimate-state">READY</span>
        <meter min="0" max="18" value="18" aria-label="Ultimate recharge"></meter></div>
    </aside>
    <nav class="finale-controls" aria-label="Combat controls">
      <span><kbd>A</kbd><kbd>D</kbd> MOVE</span><span><kbd>J</kbd> SWORD</span>
      <span><kbd>F</kbd> RIFLE</span><span><kbd>R</kbd> GUARD</span><span><kbd>SPACE</kbd> DODGE</span>
      <span class="finale-orbit-controls"><kbd>W</kbd><kbd>S</kbd> ALTITUDE</span>
    </nav>
    <div class="finale-tell" role="status" aria-live="polite"></div><div class="finale-title" aria-live="polite"></div>
    <section class="finale-dialogue" aria-live="polite"><b></b><p></p></section>
    <section class="finale-qte" role="group" aria-label="Final quick-time event" hidden>
      <span class="finale-qte-label"></span>
      <div class="finale-qte-cue"><svg class="finale-qte-target" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="38"></circle></svg>
        <svg class="finale-qte-ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="38"></circle></svg>
        <button type="button" aria-label="Perform the displayed finale action"></button></div>
      <output class="finale-qte-stars" aria-label="Timing grade"></output><small></small>
      <output class="finale-qte-misses" aria-live="polite" aria-label="No missed inputs">
        <i aria-hidden="true"></i><i aria-hidden="true"></i><i aria-hidden="true"></i></output>
      <meter min="0" max="1" value="1" aria-label="Input time remaining"></meter>
    </section>
    <div class="finale-flash" aria-hidden="true"></div>
    <section class="finale-result" aria-live="assertive" hidden>
      <span></span><h1></h1><p></p><button type="button">RETRY LAST CHECKPOINT</button>
    </section>
    <section class="finale-credits" aria-label="Credits" hidden>
      <div class="finale-credit-dancers" aria-hidden="true"></div><div class="finale-credits-roll"></div>
    </section>
    <nav class="finale-touch" aria-label="Mech controls">
      <div class="finale-touch-movement">
        <button data-key="KeyA" aria-label="Move left">LEFT</button><button data-key="KeyD" aria-label="Move right">RIGHT</button>
        <button data-key="KeyW" aria-label="Rise">UP</button><button data-key="KeyS" aria-label="Dive">DOWN</button>
      </div>
      <div class="finale-touch-actions">
        <button data-key="Space" aria-label="Boost">BOOST</button><button data-key="KeyJ" aria-label="Sword attack">SWORD</button>
        <button data-key="KeyR" aria-label="Hold to raise the shield">SHIELD</button><button data-key="KeyF" aria-label="Draw the rifle and fire a salvo">RIFLE</button>
        <button data-key="KeyE" aria-label="Blade-wave ultimate">ULTIMATE</button>
      </div>
    </nav>`;
  document.body.appendChild(root);
  document.body.classList.add('finale-active');

  const get = <T extends Element = HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Finale presentation is missing ${selector}`);
    return element;
  };
  const objective = get('.finale-objective strong');
  const hint = get('.finale-objective small');
  const playerStatus = get('.finale-player-status');
  const heroBar = get<HTMLMeterElement>('.finale-integrity');
  const shieldBar = get<HTMLMeterElement>('.finale-shield-meter');
  const energy = get('.finale-energy');
  const energyBar = get<HTMLMeterElement>('.finale-energy-meter');
  const healthValue = get('.finale-health-value');
  const shieldValue = get('.finale-shield-value');
  const ultimate = get('.finale-ultimate');
  const ultimateState = get('.finale-ultimate-state');
  const ultimateBar = get<HTMLMeterElement>('.finale-ultimate meter');
  const controls = get('.finale-controls');
  const bossHud = document.getElementById('boss-hud');
  const bossLabel = document.getElementById('boss-health-label');
  const bossFill = document.getElementById('boss-health-fill');
  if (!bossHud || !bossLabel || !bossFill) throw new Error('The shared boss health bar is missing from the finale.');
  const title = get('.finale-title');
  const skipButton = get<HTMLButtonElement>('.finale-skip');
  const boom = document.createElement('img');
  boom.src = createComicEffectArtwork('boom').toDataURL(); boom.alt = 'BOOM!';
  const dialogue = get('.finale-dialogue');
  const speaker = get('.finale-dialogue b');
  const line = get('.finale-dialogue p');
  const qte = get('.finale-qte');
  const qteLabel = get('.finale-qte-label');
  const qteButton = get<HTMLButtonElement>('.finale-qte button');
  const qteRing = get<SVGSVGElement>('.finale-qte-ring');
  const qteStars = get('.finale-qte-stars');
  const qteMisses = get('.finale-qte-misses');
  const qteMissMarks = [...qteMisses.querySelectorAll('i')];
  const qteTimer = get<HTMLMeterElement>('.finale-qte meter');
  const qteInstruction = get('.finale-qte small');
  const tell = get('.finale-tell');
  const result = get('.finale-result');
  const retry = get<HTMLButtonElement>('.finale-result button');
  const credits = get('.finale-credits');
  const roll = get('.finale-credits-roll');
  const dancers = get('.finale-credit-dancers');
  const events = new AbortController();
  let qteKey = '', muted = false, audioContext: AudioContext | null = null;
  const activeOscillators = new Set<OscillatorNode>();
  const heldPointers = new Map<number, string>();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let flashPower = 0;

  roll.innerHTML = document.getElementById('credits-content')?.innerHTML
    ?? '<h1>BRONDON\'S REVENGE</h1><p>Created by CHASS</p><p>Thank you for playing.</p>';
  retry.addEventListener('click', onRetry, { signal: events.signal });

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
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-key]')) {
    button.type = 'button';
    button.addEventListener('pointerdown', event => press(event, button.dataset.key ?? '', button), { signal: events.signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => release(event as PointerEvent), { signal: events.signal });
    }
  }
  qteButton.addEventListener('pointerdown', event => press(event, qteKey, qteButton), { signal: events.signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    qteButton.addEventListener(type, event => release(event as PointerEvent), { signal: events.signal });
  }
  function clearPointers() {
    for (const code of heldPointers.values()) onInput(code, false);
    heldPointers.clear();
  }
  window.addEventListener('blur', clearPointers, { signal: events.signal });

  const settingsOff = subscribeAudioSettings(settings => {
    if (!settings.paused) return;
    for (const oscillator of activeOscillators) {
      try { oscillator.stop(); } catch { /* The oscillator has already ended. */ }
    }
    activeOscillators.clear();
  });
  function unlockAudio() {
    if (typeof AudioContext === 'undefined') return;
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      void audioContext.resume().catch(error => console.warn('[Finale] Audio could not be resumed:', error));
    }
  }
  window.addEventListener('pointerdown', unlockAudio, { signal: events.signal });
  window.addEventListener('keydown', unlockAudio, { signal: events.signal });

  return {
    root, skipButton,
    mode(phase: string, cinematic: boolean, mech: boolean) {
      root.dataset.phase = phase;
      root.classList.toggle('cinematic', cinematic);
      root.classList.toggle('mech', mech);
      skipButton.classList.toggle('hidden', phase !== 'reveal' && phase !== 'enemyTransform' && phase !== 'heroTransform');
      playerStatus.hidden = !mech;
      ultimate.hidden = controls.hidden = !mech;
      bossHud.classList.toggle('hidden', !mech);
      if (mech) {
        bossLabel.textContent = 'SUDOERS 5';
        bossHud.setAttribute('aria-label', 'Sudoers 5 / Final Verdict health');
        bossFill.setAttribute('aria-valuemin', '0'); bossFill.setAttribute('aria-valuemax', String(DUEL.health));
      }
      get('.finale-touch').hidden = cinematic || !document.body.classList.contains('touch-device');
    },
    objective(text: string, controlHint: string) {
      objective.textContent = text;
      hint.textContent = controlHint;
    },
    title(text: string) {
      if (title.dataset.word === text) return;
      if (text === 'BOOM!') title.replaceChildren(boom);
      else title.textContent = text;
      title.dataset.word = text;
      title.hidden = !text;
    },
    dialogue(name: string, text: string) {
      speaker.textContent = name;
      line.textContent = text;
      dialogue.dataset.speaker = name;
      dialogue.hidden = !text;
    },
    stats(hp: number, enemyHp: number, power: number, shield: number, cooldown: number, warning: string, shieldLock = 0) {
      heroBar.value = Math.max(0, Math.min(1000, hp));
      playerStatus.dataset.health = hp <= DUEL.heroHealth * 0.25 ? 'low' : hp <= DUEL.heroHealth * 0.5 ? 'mid' : 'high';
      shieldBar.value = Math.max(0, Math.min(100, shield));
      bossFill.style.width = `${Math.max(0, Math.min(100, enemyHp / DUEL.health * 100))}%`;
      bossFill.setAttribute('aria-valuenow', String(Math.max(0, Math.min(DUEL.health, enemyHp))));
      healthValue.textContent = `${Math.ceil(hp)} / ${DUEL.heroHealth}`;
      energyBar.value = power;
      energy.textContent = `BOOST ${Math.ceil(power)}%`;
      shieldValue.textContent = shieldLock > 0 ? 'SHIELD BROKEN'
        : shield <= 0 ? 'RELEASE R' : `SHIELD ${Math.ceil(shield)}%`;
      ultimateState.textContent = cooldown > 0 ? `${Math.ceil(cooldown)}s` : 'READY';
      ultimateBar.max = DUEL.ultimateCooldown; ultimateBar.value = DUEL.ultimateCooldown - cooldown;
      ultimate.classList.toggle('ready', cooldown <= 0);
      tell.textContent = warning;
      tell.hidden = !warning;
    },
    qte(state: FinaleQteState | null) {
      qte.hidden = !state;
      if (!state) { qteKey = ''; return; }
      const { beat, remaining, armed, judged, judgement, stars, misses, ringScale, clock } = state;
      qteKey = beat.key;
      qte.dataset.mode = beat.mode;
      qte.dataset.judgement = judgement; qte.dataset.armed = String(armed);
      qteLabel.textContent = beat.mode === 'mash' ? 'MASH' : beat.mode === 'hold' ? 'HOLD' : 'TIME IT';
      qte.setAttribute('aria-label', `${beat.label}. ${beat.mode === 'mash' ? 'Press repeatedly' : beat.mode === 'hold'
        ? 'Hold to charge' : 'Press as the rings meet'}. Three missed commands break the link.`);
      qteButton.textContent = KEY_LABELS[beat.key] ?? beat.key.replace('Key', '').toUpperCase();
      qteButton.setAttribute('aria-label', `${qteLabel.textContent}: ${qteButton.textContent}`);
      qteButton.classList.toggle('success', judgement === 'success');
      qteButton.disabled = judged;
      qteTimer.value = Math.max(0, Math.min(1, remaining));
      qteRing.style.transform = `scale(${beat.mode === 'tap' ? Math.min(2, ringScale) : 1.2}) rotate(-90deg)`;
      qteRing.style.strokeDasharray = beat.mode === 'tap' ? '' : '239';
      qteRing.style.strokeDashoffset = beat.mode === 'tap' ? '' : String(239 * (1 - state.inputProgress));
      qteStars.textContent = '\u2605'.repeat(stars) + '\u2606'.repeat(3 - stars);
      qteStars.hidden = judgement !== 'success';
      qteStars.setAttribute('aria-label', `${stars} of 3 timing stars`);
      qteMissMarks.forEach((mark, index) => mark.classList.toggle('missed', index < misses));
      qteMisses.setAttribute('aria-label', `${misses} of 3 missed commands`);
      if (judgement === 'success') qteInstruction.textContent = stars === 3 ? 'PERFECT' : stars === 2 ? 'PRECISE' : 'GOOD';
      else if (judgement === 'miss') qteInstruction.textContent = 'MISSED';
      else if (!armed) qteInstruction.textContent = 'READY';
      else qteInstruction.textContent = reducedMotion && beat.mode === 'tap'
        && Math.abs(clock - finisherActionTime(beat)) <= 0.14 ? 'NOW' : '';
    },
    flash(amount: number) {
      flashPower = reducedMotion ? 0 : Math.max(flashPower, Math.max(0, Math.min(0.65, amount)));
    },
    speedLines(power: number) {
      get('.finale-speed-lines').style.opacity = String(reducedMotion ? 0 : Math.max(0, Math.min(0.42, power)));
    },
    update(dt: number) {
      flashPower = Math.max(0, flashPower - dt * 2.8);
      get('.finale-flash').style.opacity = String(flashPower);
    },
    result(titleText: string, description: string, canRetry: boolean, kicker = 'SIGNAL LOST') {
      result.hidden = !titleText;
      get('.finale-result h1').textContent = titleText;
      get('.finale-result p').textContent = description;
      get('.finale-result span').textContent = kicker;
      retry.hidden = !canRetry;
    },
    credits(time: number) {
      credits.hidden = time < 0;
      const progress = Math.min(1, Math.max(0, time) / FINALE_DURATION.credits);
      const travel = window.innerHeight + roll.scrollHeight + window.innerHeight * 0.25;
      roll.style.transform = `translate(-50%, ${window.innerHeight - progress * travel}px)`;
    },
    setCreditSprite(sprite: { image: string; frames: number; duration: number; aspect: number }) {
      dancers.replaceChildren();
      for (let i = 0; i < 24; i++) {
        const dancer = document.createElement('span'); dancer.className = 'finale-credit-dancer';
        const column = i % 6, row = Math.floor(i / 6);
        dancer.style.left = `${column * 19 - 3 + Math.sin(i * 2.3) * 5}%`;
        dancer.style.top = `${row * 30 - 8 + Math.cos(i * 1.7) * 6}%`;
        dancer.style.setProperty('--dancer-size', `${90 + i % 4 * 25}px`);
        dancer.style.setProperty('--dancer-aspect', String(sprite.aspect));
        dancer.style.setProperty('--dancer-turn', `${[0, -35, 24, 90, -90, 165, -145][i % 7]}deg`);
        dancer.style.setProperty('--dancer-flip', i % 3 === 0 ? '-1' : '1');
        dancer.style.backgroundImage = `url("${sprite.image}")`;
        dancer.style.backgroundSize = `${(sprite.frames + 1) * 100}% 100%`;
        dancer.style.animationDuration = `${sprite.duration}s`;
        dancer.style.animationTimingFunction = `steps(${sprite.frames})`;
        dancer.style.animationDelay = `${-i * 0.073}s`;
        dancers.appendChild(dancer);
      }
    },
    pause(value: boolean) {
      muted = value;
      clearPointers();
      if (value) for (const oscillator of activeOscillators) {
        try { oscillator.stop(); } catch { /* The oscillator has already ended. */ }
      }
      activeOscillators.clear();
    },
    sound(kind: 'hit' | 'launch' | 'parry' | 'special' | 'qte' | 'explode') {
      if (!audioContext || audioContext.state !== 'running' || muted || getAudioSettings().paused || activeOscillators.size >= 12) return;
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), now = audioContext.currentTime;
      const frequency = { hit: 110, launch: 210, parry: 840, special: 65, qte: 660, explode: 45 }[kind];
      oscillator.type = kind === 'parry' || kind === 'qte' ? 'sine' : 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * 0.25), now + 0.3);
      gain.gain.setValueAtTime(0.07 * getAudioSettings().sfx, now);
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
        void audioContext.close().catch(error => console.warn('[Finale] Audio context could not close:', error));
      }
      root.remove();
      document.body.classList.remove('finale-active');
    },
  };
}
