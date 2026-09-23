/**
 * Touch controls for mobile browsers.
 * Left virtual joystick: WASD movement (or dodge in flight).
 * Right area drag: camera look (on-foot) or aim offset (flight).
 * Action buttons: jump, sprint, interact, weapon swap, fire, evade.
 *
 * The module dispatches synthetic KeyboardEvents and MouseEvents so existing
 * input handlers in player.ts, pistol.ts, and scene15.ts consume them without
 * modification. Camera look in player.ts has a small touchMode bypass.
 */

let active = false;
let flightMode = false;
let root: HTMLElement | null = null;

// Movement joystick state
let moveTouchId: number | null = null;
let moveCenterX = 0;
let moveCenterY = 0;
const heldKeys = new Set<string>();

// Camera / flight-aim touch state
let lookTouchId: number | null = null;
let lookLastX = 0;
let lookLastY = 0;
let flightAimX = 0;
let flightAimY = 0;

// Flight-mode joystick visual
let flightStickActive = false;
let flightStickId: number | null = null;
let flightStickCenterX = 0;
let flightStickCenterY = 0;
let flightStickEl: HTMLElement | null = null;
let flightKnobEl: HTMLElement | null = null;

// Button press tracking
const pressedButtons = new Set<string>();
let fireActive = false;
type AttackLabel = 'SHOOT' | 'SWING';
const touchAttacks = new Set<{ attack: () => boolean; label: () => AttackLabel | null }>();
const buttonBindings: Array<{ reset: () => void; dispose: () => void }> = [];

const JOYSTICK_RADIUS = 50;
const LOOK_SENSITIVITY = 2.5;
const FLIGHT_AIM_SENSITIVITY = 0.008;
const DEAD_ZONE = 12;

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function isTouchActive(): boolean {
  return active;
}

export function isTouchFire(): boolean {
  return fireActive;
}

/** Register the real weapon action and its equipped state; return its cleanup. */
export function registerTouchAttackCallback(attack: () => boolean, label: () => AttackLabel | null) {
  const entry = { attack, label };
  touchAttacks.add(entry);
  refreshTouchAttackButton();
  return () => { touchAttacks.delete(entry); refreshTouchAttackButton(); };
}

export function refreshTouchAttackButton() {
  if (!active) return;
  const button = document.getElementById('touch-attack') as HTMLButtonElement | null;
  if (!button) return;
  const weapon = [...touchAttacks].find(entry => entry.label() !== null);
  button.textContent = weapon?.label() ?? 'ATTACK';
  button.disabled = !weapon;
}

function dispatchKeyDown(code: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
}

function dispatchKeyUp(code: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
}

function pressKey(code: string) {
  if (heldKeys.has(code)) return;
  heldKeys.add(code);
  dispatchKeyDown(code);
}

function releaseKey(code: string) {
  if (!heldKeys.has(code)) return;
  heldKeys.delete(code);
  dispatchKeyUp(code);
}

function releaseAllKeys() {
  for (const code of heldKeys) dispatchKeyUp(code);
  heldKeys.clear();
}

function updateMovementJoystick(dx: number, dy: number) {
  const len = Math.sqrt(dx * dx + dy * dy);
  const clampedLen = Math.min(len, JOYSTICK_RADIUS);
  const angle = Math.atan2(dy, dx);
  const cx = Math.cos(angle) * clampedLen;
  const cy = Math.sin(angle) * clampedLen;

  const knob = root?.querySelector<HTMLElement>('.touch-knob');
  if (knob) knob.style.transform = `translate(${cx}px, ${cy}px)`;

  if (len < DEAD_ZONE) {
    releaseKey('KeyW'); releaseKey('KeyS'); releaseKey('KeyA'); releaseKey('KeyD');
    return;
  }

  const normX = cx / JOYSTICK_RADIUS;
  const normY = cy / JOYSTICK_RADIUS;
  if (normY < -0.3) pressKey('KeyW'); else releaseKey('KeyW');
  if (normY > 0.3) pressKey('KeyS'); else releaseKey('KeyS');
  if (normX < -0.3) pressKey('KeyA'); else releaseKey('KeyA');
  if (normX > 0.3) pressKey('KeyD'); else releaseKey('KeyD');
}

function updateFlightJoystick(dx: number, dy: number) {
  const len = Math.sqrt(dx * dx + dy * dy);
  const clampedLen = Math.min(len, JOYSTICK_RADIUS);
  const angle = Math.atan2(dy, dx);
  const cx = Math.cos(angle) * clampedLen;
  const cy = Math.sin(angle) * clampedLen;

  if (flightKnobEl) flightKnobEl.style.transform = `translate(${cx}px, ${cy}px)`;

  if (len < DEAD_ZONE) {
    releaseKey('KeyW'); releaseKey('KeyS'); releaseKey('KeyA'); releaseKey('KeyD');
    return;
  }

  const normX = cx / JOYSTICK_RADIUS;
  const normY = cy / JOYSTICK_RADIUS;
  if (normY < -0.3) pressKey('KeyW'); else releaseKey('KeyW');
  if (normY > 0.3) pressKey('KeyS'); else releaseKey('KeyS');
  if (normX < -0.3) pressKey('KeyA'); else releaseKey('KeyA');
  if (normX > 0.3) pressKey('KeyD'); else releaseKey('KeyD');
}

function handleButton(code: string, pressed: boolean) {
  if (pressed) {
    if (pressedButtons.has(code)) return;
    pressedButtons.add(code);
    dispatchKeyDown(code);
  } else {
    if (!pressedButtons.has(code)) return;
    pressedButtons.delete(code);
    dispatchKeyUp(code);
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.touch-controls, button, dialog, input, textarea');
}

function onTouchStart(event: TouchEvent) {
  if (!active) return;
  if (root?.classList.contains('hidden')) return;
  if (document.body.classList.contains('quick-menu-open')) return;
  const width = window.innerWidth;

  for (const touch of Array.from(event.changedTouches)) {
    if (isInteractiveTarget(touch.target)) continue;
    event.preventDefault();

    if (touch.clientX < width * 0.4 && moveTouchId === null && !flightMode) {
      moveTouchId = touch.identifier;
      moveCenterX = touch.clientX;
      moveCenterY = touch.clientY;
      const base = root?.querySelector<HTMLElement>('.touch-move-base');
      if (base) {
        base.style.left = `${touch.clientX}px`;
        base.style.top = `${touch.clientY}px`;
        base.style.opacity = '1';
      }
    } else if (flightMode && touch.clientX < width * 0.45 && flightStickId === null) {
      flightStickId = touch.identifier;
      flightStickCenterX = touch.clientX;
      flightStickCenterY = touch.clientY;
      flightStickActive = true;
      if (flightStickEl) {
        flightStickEl.style.left = `${touch.clientX}px`;
        flightStickEl.style.top = `${touch.clientY}px`;
        flightStickEl.style.opacity = '1';
      }
    } else if (touch.clientX >= width * 0.4 && lookTouchId === null) {
      lookTouchId = touch.identifier;
      lookLastX = touch.clientX;
      lookLastY = touch.clientY;
    }
  }
}

function onTouchMove(event: TouchEvent) {
  if (!active) return;
  if (document.body.classList.contains('quick-menu-open')) return;
  event.preventDefault();

  for (const touch of Array.from(event.changedTouches)) {
    if (touch.identifier === moveTouchId) {
      updateMovementJoystick(touch.clientX - moveCenterX, touch.clientY - moveCenterY);
    } else if (touch.identifier === flightStickId) {
      updateFlightJoystick(touch.clientX - flightStickCenterX, touch.clientY - flightStickCenterY);
    } else if (touch.identifier === lookTouchId) {
      const dx = touch.clientX - lookLastX;
      const dy = touch.clientY - lookLastY;
      lookLastX = touch.clientX;
      lookLastY = touch.clientY;

      if (flightMode) {
        flightAimX += dx * FLIGHT_AIM_SENSITIVITY;
        flightAimY -= dy * FLIGHT_AIM_SENSITIVITY;
        flightAimX = Math.max(-1, Math.min(1, flightAimX));
        flightAimY = Math.max(-1, Math.min(1, flightAimY));
      } else {
        window.dispatchEvent(new MouseEvent('mousemove', {
          movementX: dx * LOOK_SENSITIVITY,
          movementY: dy * LOOK_SENSITIVITY,
          bubbles: true,
        }));
      }
    }
  }
}

function onTouchEnd(event: TouchEvent) {
  if (!active) return;

  for (const touch of Array.from(event.changedTouches)) {
    if (touch.identifier === moveTouchId) {
      moveTouchId = null;
      releaseKey('KeyW'); releaseKey('KeyS'); releaseKey('KeyA'); releaseKey('KeyD');
      const knob = root?.querySelector<HTMLElement>('.touch-knob');
      if (knob) knob.style.transform = 'translate(0, 0)';
      const base = root?.querySelector<HTMLElement>('.touch-move-base');
      if (base) base.style.opacity = '0';
    } else if (touch.identifier === flightStickId) {
      flightStickId = null;
      flightStickActive = false;
      releaseKey('KeyW'); releaseKey('KeyS'); releaseKey('KeyA'); releaseKey('KeyD');
      if (flightKnobEl) flightKnobEl.style.transform = 'translate(0, 0)';
      if (flightStickEl) flightStickEl.style.opacity = '0';
    } else if (touch.identifier === lookTouchId) {
      lookTouchId = null;
    }
  }
}

function bindButton(elementId: string, code: string) {
  bindPressControl(elementId, () => handleButton(code, true), () => handleButton(code, false));
}

function bindFire() {
  const element = document.getElementById('touch-fire');
  if (!element) return;

  element.addEventListener('touchstart', event => {
    event.preventDefault(); event.stopPropagation();
    element.classList.add('active');
    fireActive = true;
  }, { passive: false });

  element.addEventListener('touchend', event => {
    event.preventDefault(); event.stopPropagation();
    element.classList.remove('active');
    fireActive = false;
  }, { passive: false });

  element.addEventListener('touchcancel', event => {
    event.preventDefault();
    element.classList.remove('active');
    fireActive = false;
  }, { passive: false });
}

function bindEvade() {
  const element = document.getElementById('touch-evade');
  if (!element) return;

  element.addEventListener('touchstart', event => {
    event.preventDefault(); event.stopPropagation();
    element.classList.add('active');
    dispatchKeyDown('Space');
  }, { passive: false });

  element.addEventListener('touchend', event => {
    event.preventDefault(); event.stopPropagation();
    element.classList.remove('active');
    dispatchKeyUp('Space');
  }, { passive: false });

  element.addEventListener('touchcancel', event => {
    event.preventDefault();
    element.classList.remove('active');
    dispatchKeyUp('Space');
  }, { passive: false });
}

export function initTouchControls() {
  if (active || !isTouchDevice()) return;
  root = document.getElementById('touch-controls');
  if (!root) return;
  active = true;
  (window as any).__touchActive = true;

  flightStickEl = document.getElementById('touch-flight-stick');
  flightKnobEl = document.getElementById('touch-flight-knob');

  root.classList.remove('hidden');
  document.body.classList.add('touch-device');

  document.addEventListener('touchstart', onTouchStart, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: false });
  document.addEventListener('touchcancel', onTouchEnd, { passive: false });

  bindButton('touch-jump', 'Space');
  bindButton('touch-sprint', 'ShiftLeft');
  bindButton('touch-interact', 'KeyE');
  bindButton('touch-crouch', 'KeyC');
  bindButton('touch-pistol', 'KeyK');
  bindButton('touch-crowbar', 'KeyT');
  bindButton('touch-goggles', 'KeyN');
  bindButton('touch-action9', 'Digit9');
  bindButton('touch-view', 'KeyV');
  bindButton('touch-menu', 'Enter');
  bindFire();
  bindEvade();
  bindAttack();
}

function bindAttack() {
  bindPressControl('touch-attack', () => {
    if (flightMode) return;
    refreshTouchAttackButton();
    const weapon = [...touchAttacks].find(entry => entry.label() !== null);
    weapon?.attack();
  });
  refreshTouchAttackButton();
}

function bindPressControl(elementId: string, onPress: () => void, onRelease: () => void = () => {}) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const listeners = new AbortController();
  const options = { passive: false, signal: listeners.signal };
  let press: { kind: 'pointer' | 'touch'; id: number } | null = null;
  let suppressClick = false;

  const consume = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  const allowed = () => active && !!root && !root.classList.contains('hidden')
    && !(element as HTMLButtonElement).disabled && !document.hidden
    && !document.body.classList.contains('quick-menu-open');
  const reset = () => {
    const previous = press;
    press = null;
    element.classList.remove('active');
    if (previous) onRelease();
    if (previous?.kind === 'pointer' && element.hasPointerCapture?.(previous.id)) {
      element.releasePointerCapture(previous.id);
    }
  };
  const begin = (kind: 'pointer' | 'touch', id: number) => {
    if (press || !allowed()) return;
    press = { kind, id };
    suppressClick = true;
    element.classList.add('active');
    onPress();
    // Opening the menu may hide the control before its release event arrives.
    if (!allowed()) reset();
  };

  element.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    consume(event);
    // A movement/look finger may already be down, so non-primary pointers count.
    begin('pointer', event.pointerId);
    if (press?.kind === 'pointer' && press.id === event.pointerId) {
      try { element.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
    }
  }, options);
  const releasePointer = (event: PointerEvent) => {
    if (press?.kind !== 'pointer' || press.id !== event.pointerId) return;
    reset();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    element.addEventListener(type, releasePointer, options);
  }
  window.addEventListener('pointerup', releasePointer, options);
  window.addEventListener('pointercancel', releasePointer, options);

  element.addEventListener('touchstart', event => {
    consume(event);
    const touch = event.changedTouches[0];
    if (touch) begin('touch', touch.identifier);
  }, options);
  const releaseTouch = (event: TouchEvent) => {
    consume(event);
    if (press?.kind === 'touch' && Array.from(event.changedTouches).some(touch => touch.identifier === press?.id)) reset();
  };
  element.addEventListener('touchend', releaseTouch, options);
  element.addEventListener('touchcancel', releaseTouch, options);
  element.addEventListener('click', event => {
    consume(event);
    // Pointer/touch activation has already fired. Keep keyboard/AT clicks usable.
    if (press || (suppressClick && event.detail !== 0)) { suppressClick = false; return; }
    suppressClick = false;
    if (!allowed()) return;
    onPress();
    onRelease();
  }, options);
  // Do not let compatibility mouse events also invoke the desktop weapon handler.
  element.addEventListener('mousedown', consume, options);
  element.addEventListener('mouseup', consume, options);
  window.addEventListener('blur', reset, options);
  document.addEventListener('visibilitychange', reset, options);
  buttonBindings.push({ reset, dispose: () => { reset(); listeners.abort(); } });
}

/** Switch the right-side input and left joystick between on-foot and flight modes. */
export function setTouchFlightMode(enabled: boolean) {
  for (const binding of buttonBindings) binding.reset();
  flightMode = enabled;
  flightAimX = 0;
  flightAimY = 0;
  if (root) {
    root.classList.toggle('flight-mode', enabled);
    releaseKey('KeyW'); releaseKey('KeyS'); releaseKey('KeyA'); releaseKey('KeyD');
    if (flightKnobEl) flightKnobEl.style.transform = 'translate(0, 0)';
    if (flightStickEl && !enabled) flightStickEl.style.opacity = '0';
    const knob = root.querySelector<HTMLElement>('.touch-knob');
    if (knob) knob.style.transform = 'translate(0, 0)';
    const base = root.querySelector<HTMLElement>('.touch-move-base');
    if (base && !enabled) base.style.opacity = '0';
  }
  moveTouchId = null;
  flightStickId = null;
  flightStickActive = false;
}

/** Read and reset the per-frame flight aim deltas. */
export function consumeFlightAim(): { dx: number; dy: number } {
  const dx = flightAimX;
  const dy = flightAimY;
  flightAimX = 0;
  flightAimY = 0;
  return { dx, dy };
}

/** Tear down all listeners and DOM state. */
export function disposeTouchControls() {
  if (!active) return;
  for (const binding of buttonBindings) binding.dispose();
  buttonBindings.length = 0;
  active = false;
  (window as any).__touchActive = false;
  flightMode = false;
  document.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
  document.removeEventListener('touchcancel', onTouchEnd);
  releaseAllKeys();
  pressedButtons.clear();
  fireActive = false;
  root?.classList.add('hidden');
  root?.classList.remove('flight-mode');
  document.body.classList.remove('touch-device');
}
