import { AudioManager, getAudioSettings, subscribeAudioSettings } from '../audio/AudioManager.js';
import jungleMusic from '../../assets/bgm/DonRevJungleLoop.m4a?url';
import battleMusic from '../../assets/bgm/DonRevLevel2.m4a?url';
import { DUEL, type FinisherBeat } from '../../scripts/mechDuel.js';

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
    <section class="finale-player-status" aria-label="Prime Frame status">
      <strong>BRONDON / PRIME FRAME</strong>
      <meter class="finale-integrity" min="0" max="1000" value="1000" aria-label="Prime Frame integrity"></meter>
      <meter class="finale-shield-meter" min="0" max="100" value="100" aria-label="Prime Frame shield"></meter>
      <div class="finale-resources"><span class="finale-energy">ENERGY 100%</span>
        <span class="finale-shield-value">SHIELD 100% / HOLD R</span><span class="finale-sync">SYNC 0%</span></div>
    </section>
    <div class="finale-tell" role="status" aria-live="polite"></div><div class="finale-title" aria-live="polite"></div>
    <section class="finale-dialogue" aria-live="polite"><b></b><p></p></section>
    <section class="finale-qte" role="group" aria-label="Final quick-time event" hidden>
      <span></span><button type="button" aria-label="Perform the displayed finale action"></button>
      <div class="finale-qte-track"><i></i></div><meter min="0" max="1" value="1" aria-label="Time remaining"></meter><small></small>
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
        <button data-key="KeyE" aria-label="Overdrive">OVERDRIVE</button>
      </div>
    </nav>`;
  document.body.appendChild(root);
  document.body.classList.add('finale-active');

  const get = <T extends HTMLElement = HTMLElement>(selector: string) => {
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
  const shieldValue = get('.finale-shield-value');
  const sync = get('.finale-sync');
  const bossHud = document.getElementById('boss-hud');
  const bossLabel = document.getElementById('boss-health-label');
  const bossFill = document.getElementById('boss-health-fill');
  if (!bossHud || !bossLabel || !bossFill) throw new Error('The shared boss health bar is missing from the finale.');
  const title = get('.finale-title');
  const dialogue = get('.finale-dialogue');
  const speaker = get('.finale-dialogue b');
  const line = get('.finale-dialogue p');
  const qte = get('.finale-qte');
  const qteLabel = get('.finale-qte span');
  const qteButton = get<HTMLButtonElement>('.finale-qte button');
  const qteTrack = get('.finale-qte-track i');
  const qteTimer = get<HTMLMeterElement>('.finale-qte meter');
  const qteInstruction = get('.finale-qte small');
  const tell = get('.finale-tell');
  const result = get('.finale-result');
  const retry = get<HTMLButtonElement>('.finale-result button');
  const credits = get('.finale-credits');
  const roll = get('.finale-credits-roll');
  const dancers = get('.finale-credit-dancers');
  const events = new AbortController();
  let qteKey = '', muted = false, audio: AudioManager | null = null, audioContext: AudioContext | null = null;
  const activeOscillators = new Set<OscillatorNode>();
  const heldPointers = new Map<number, string>();

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

  if (typeof Audio !== 'undefined') {
    audio = new AudioManager({ getFile: (path: string) => ({ content: path === 'jungle' ? jungleMusic : battleMusic }) });
    audio.setBgm({ path: 'jungle', loop: true, volume: 0.48, autoplay: true });
  }
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
    root,
    mode(phase: string, cinematic: boolean, mech: boolean) {
      root.dataset.phase = phase;
      root.classList.toggle('cinematic', cinematic);
      root.classList.toggle('mech', mech);
      playerStatus.hidden = !mech;
      bossHud.classList.toggle('hidden', !mech);
      if (mech) {
        bossLabel.textContent = 'THE QUINTET / FINAL VERDICT';
        bossHud.setAttribute('aria-label', 'The Quintet / Final Verdict health');
      }
      get('.finale-touch').hidden = cinematic || !document.body.classList.contains('touch-device');
    },
    objective(text: string, controlHint: string) {
      objective.textContent = text;
      hint.textContent = controlHint;
    },
    title(text: string) {
      title.textContent = text;
      title.hidden = !text;
    },
    dialogue(name: string, text: string) {
      speaker.textContent = name;
      line.textContent = text;
      dialogue.dataset.speaker = name;
      dialogue.hidden = !text;
    },
    stats(hp: number, enemyHp: number, power: number, shield: number, charge: number, warning: string, shieldLock = 0) {
      heroBar.value = Math.max(0, Math.min(1000, hp));
      shieldBar.value = Math.max(0, Math.min(100, shield));
      bossFill.style.width = `${Math.max(0, Math.min(100, enemyHp / DUEL.health * 100))}%`;
      bossFill.setAttribute('aria-valuenow', String(Math.max(0, Math.min(DUEL.health, enemyHp))));
      energy.textContent = `ENERGY ${Math.ceil(power)}%`;
      shieldValue.textContent = shieldLock > 0 ? 'SHIELD BREAK / REFORMING'
        : shield <= 0 ? 'SHIELD DEPLETED / RELEASE R TO RECHARGE' : `SHIELD ${Math.ceil(shield)}% / HOLD R`;
      sync.textContent = charge >= 100 ? 'OVERDRIVE READY / E' : `SYNC ${Math.floor(charge)}%`;
      tell.textContent = warning;
      tell.hidden = !warning;
    },
    qte(beat: FinisherBeat | null, remaining = 1, held = 0, resolved = false, presses = 0, progress = 0, armed = false) {
      qte.hidden = !beat;
      if (!beat) { qteKey = ''; return; }
      qteKey = beat.key;
      qte.dataset.mode = beat.mode;
      qteLabel.textContent = beat.label;
      qteButton.textContent = KEY_LABELS[beat.key] ?? beat.key.replace('Key', '').toUpperCase();
      qteButton.classList.toggle('success', resolved);
      qteButton.disabled = resolved;
      qteTimer.value = Math.max(0, Math.min(1, remaining));
      qteTrack.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
      if (resolved) qteInstruction.textContent = 'LOCKED IN';
      else if (!armed) qteInstruction.textContent = 'WAIT FOR THE PULSE';
      else if (beat.mode === 'hold') qteInstruction.textContent = `HOLD / ${Math.floor(progress * 100)}%`;
      else if (beat.mode === 'mash') qteInstruction.textContent = `RAPID PRESS / ${presses} OF ${beat.presses}`;
      else qteInstruction.textContent = 'PRESS NOW';
      qte.dataset.held = String(held);
    },
    flash(amount: number) {
      get('.finale-flash').style.opacity = String(Math.max(0, Math.min(0.75, amount)));
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
      const progress = Math.min(1, Math.max(0, time) / 48);
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
    music(battle: boolean) {
      audio?.setBgm({ path: battle ? 'battle' : 'jungle', loop: true, volume: battle ? 0.56 : 0.48, autoplay: true });
    },
    pause(value: boolean) {
      muted = value;
      clearPointers();
      audio?.setMenuPaused(value);
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
      audio?.dispose();
      if (audioContext) {
        void audioContext.close().catch(error => console.warn('[Finale] Audio context could not close:', error));
      }
      root.remove();
      document.body.classList.remove('finale-active');
    },
  };
}
