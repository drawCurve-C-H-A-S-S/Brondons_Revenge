export type InputMode = 'keyboard' | 'controller';
const CONTROLLER_TYPES = ['switch', 'xbox', 'playstation'] as const;
export type ControllerType = typeof CONTROLLER_TYPES[number];
export type ControllerContext = 'foot' | 'flight' | 'platformer' | 'finale' | 'finale-qte' | 'escape' | 'cinematic' | 'inspection';
export type ControllerMenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';
export const CONTROLLER_DEAD_ZONE = 0.18;
const BUTTONS = ['b', 'a', 'y', 'x', 'l', 'r', 'zl', 'zr', 'minus', 'plus', 'up', 'down', 'left', 'right'] as const;
type ControllerButton = typeof BUTTONS[number];
type ButtonBinding = { button: number } | { axis: number; value: number; neutral: number; trigger: boolean };
interface AxisBinding { axis: number; sign: number; neutral: number; }
interface ControllerLayout {
  buttons: Record<ControllerButton, ButtonBinding>;
  leftX: AxisBinding; leftY: AxisBinding; rightX: AxisBinding; rightY: AxisBinding;
}
interface Stick { x: number; y: number; }
export interface ControllerStatus {
  mode: InputMode;
  type: ControllerType | null;
  name: string | null;
  ready: boolean;
  canSetup: boolean;
  swapAB: boolean;
  message: string;
  setupStep: string | null;
}
interface GamepadInputOptions {
  getContext: () => { id: string; kind: ControllerContext; menuOpen: boolean; wheelOpen: boolean };
  onModeChange: (mode: InputMode) => void;
  onStatus: (status: ControllerStatus) => void;
  onNotice: (message: string) => void;
  onMenuAction: (action: ControllerMenuAction) => void;
  aimWheel: (x: number, y: number) => void;
  cancelWheel: () => void;
}

let mode: InputMode = 'keyboard';
let controllerType: ControllerType | null = null;
let movement: Stick = { x: 0, y: 0 };
let resetActiveInput: (() => void) | null = null;
const controllerEvents = new WeakSet<Event>();
export function isControllerActive() { return mode === 'controller'; }
export function isControllerEvent(event: Event) { return controllerEvents.has(event); }
export function getControllerMovement(): Readonly<Stick> { return movement; }
export function resetControllerInput() { resetActiveInput?.(); }
export function getControllerType() { return controllerType; }
export function isControllerType(value: string): value is ControllerType {
  return CONTROLLER_TYPES.some(type => type === value);
}

const directionalLabels = { up: 'D-pad Up', down: 'D-pad Down', left: 'D-pad Left', right: 'D-pad Right' };
const profiles: Record<ControllerType, {
  name: string; labels: Record<ControllerButton, string>; confirm: ControllerButton; cancel: ControllerButton;
}> = {
  switch: { name: 'Switch', confirm: 'a', cancel: 'b',
    labels: { a: 'A', b: 'B', y: 'Y', x: 'X', l: 'L', r: 'R', zl: 'ZL', zr: 'ZR',
      minus: '-', plus: '+', ...directionalLabels } },
  xbox: { name: 'Xbox', confirm: 'b', cancel: 'a',
    labels: { a: 'B', b: 'A', y: 'X', x: 'Y', l: 'LB', r: 'RB', zl: 'LT', zr: 'RT',
      minus: 'View', plus: 'Menu', ...directionalLabels } },
  playstation: { name: 'PlayStation', confirm: 'b', cancel: 'a',
    labels: { a: 'Circle', b: 'Cross', y: 'Square', x: 'Triangle', l: 'L1', r: 'R1', zl: 'L2', zr: 'R2',
      minus: 'Create / Share', plus: 'Options', ...directionalLabels } },
};
export function controllerButtonLabel(button: ControllerButton) {
  return profiles[controllerType ?? 'switch'].labels[button];
}
export function controllerMenuLabel(action: 'confirm' | 'back' | 'pause') {
  const profile = profiles[controllerType ?? 'switch'];
  return controllerButtonLabel(action === 'pause' ? 'plus' : action === 'confirm' ? profile.confirm : profile.cancel);
}
export function controllerText(text: string) {
  return text.replace(/\{([a-z]+)\}/g, (_, value: string) => {
    const button = BUTTONS.find(button => button === value);
    if (!button) throw new Error(`Unknown controller button in hint: ${value}`);
    return controllerButtonLabel(button);
  });
}

/** Radial dead zone preserves direction and analog speed, including diagonals. */
export function controllerStick(x: number, y: number): Stick {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= CONTROLLER_DEAD_ZONE) return { x: 0, y: 0 };
  const scale = (Math.min(1, length) - CONTROLLER_DEAD_ZONE) / (1 - CONTROLLER_DEAD_ZONE) / length;
  return { x: x * scale, y: y * scale };
}

const standardLayout: ControllerLayout = {
  // Browser-standard buttons are physical positions, independent of their printed names.
  buttons: { a: { button: 1 }, b: { button: 0 }, y: { button: 2 }, x: { button: 3 },
    l: { button: 4 }, r: { button: 5 }, zl: { button: 6 }, zr: { button: 7 },
    minus: { button: 8 }, plus: { button: 9 },
    up: { button: 12 }, down: { button: 13 }, left: { button: 14 }, right: { button: 15 } },
  leftX: { axis: 0, sign: 1, neutral: 0 }, leftY: { axis: 1, sign: 1, neutral: 0 },
  rightX: { axis: 2, sign: 1, neutral: 0 }, rightY: { axis: 3, sign: 1, neutral: 0 },
};
const footKeys: Partial<Record<ControllerButton, string>> = {
  b: 'Space', r: 'KeyE', y: 'KeyC', x: 'KeyV', zl: 'ShiftLeft', l: 'Tab', zr: 'KeyN',
  minus: 'Enter', up: 'KeyT', down: 'KeyQ', left: 'KeyR', right: 'Digit9',
};
const contextKeys: Record<ControllerContext, Partial<Record<ControllerButton, string>>> = {
  foot: footKeys, platformer: footKeys,
  inspection: { r: 'KeyE', b: 'Escape', left: 'KeyR' },
  cinematic: { r: 'KeyE', b: 'Space', left: 'KeyR', minus: 'Enter' },
  flight: { b: 'Space', r: 'Enter', x: 'KeyV', minus: 'Enter' },
  finale: { a: 'KeyJ', x: 'KeyF', zl: 'KeyR', b: 'Space', r: 'KeyE', minus: 'Enter' },
  'finale-qte': { a: 'KeyJ', x: 'KeyF', zl: 'KeyR', b: 'Space', r: 'KeyE', y: 'KeyD',
    left: 'KeyA', up: 'KeyW', minus: 'Enter' },
  escape: { a: 'KeyY', x: 'KeyU', b: 'KeyI', y: 'KeyO', r: 'KeyE', minus: 'Enter' },
};
const labels: Record<string, string> = {
  KeyW: 'Left stick up', KeyS: 'Left stick down', KeyA: 'Left stick left', KeyD: 'Left stick right',
  ArrowUp: 'Left stick up', ArrowDown: 'Left stick down', ArrowLeft: 'Left stick left', ArrowRight: 'Left stick right',
  Space: '{b}', KeyE: '{r}', KeyC: '{y}', ShiftLeft: '{zl}', Tab: '{l}', MouseLeft: '{a}',
  KeyV: '{x}', KeyN: '{zr}', KeyQ: '{down}', KeyT: '{up}', Digit9: '{right}',
  KeyM: '{plus}', Escape: '{plus}', Enter: '{minus}', KeyR: '{left}',
};
export function controllerLabel(code: string, context: ControllerContext = 'foot') {
  if (context === 'inspection' && code === 'MouseLeft') return controllerMenuLabel('confirm');
  if (context === 'inspection' && code === 'Escape') return controllerMenuLabel('back');
  if (context === 'flight' && code === 'Enter') return controllerButtonLabel('r');
  if (context === 'finale' || context === 'finale-qte') {
    if (code === 'KeyJ') return controllerButtonLabel('a');
    if (code === 'KeyF') return controllerButtonLabel('x');
    if (code === 'KeyR') return controllerButtonLabel('zl');
    if (context === 'finale-qte') {
      if (code === 'KeyD') return controllerButtonLabel('y');
      if (code === 'KeyA') return controllerButtonLabel('left');
      if (code === 'KeyW') return controllerButtonLabel('up');
    }
  }
  if (context === 'escape') {
    const escapeLabels: Record<string, ControllerButton> = { KeyY: 'a', KeyU: 'x', KeyI: 'b', KeyO: 'y' };
    if (escapeLabels[code]) return controllerButtonLabel(escapeLabels[code]);
  }
  return controllerText(labels[code] ?? code.replace(/^Key|^Digit/, ''));
}

/** Use only for input hints, not dialogue or arbitrary prose. */
export function inputHint(text: string, context: ControllerContext = 'foot') {
  if (!isControllerActive()) return text;
  return text.replace(/\b(WASD(?:\s*\/\s*arrows)?|[Ll]eft click|LMB|[Mm]ouse|[Cc]lick|Shift|Space|Tab|Enter|Esc(?:ape)?|[ACDEFIJMNQRTUVWY]|9)\b(?!-pad)/g, token => {
    if (token.startsWith('WASD')) return 'Left stick';
    if (/mouse/i.test(token)) return 'Right stick';
    if (/click|LMB/i.test(token)) return controllerLabel('MouseLeft', context);
    const code = token === 'Shift' ? 'ShiftLeft' : /^Esc/.test(token) ? 'Escape'
      : token === '9' ? 'Digit9' : token.length === 1 ? `Key${token}` : token;
    return controllerLabel(code, context);
  });
}

export const CONTROLLER_LESSONS: Record<string, string[]> = {
  quarters: ['Left stick - walk / Hold {zl} - sprint / Right stick - look',
    '{y} while moving forward - slide tackle; otherwise toggle crouch',
    'Look at a nameplate to see the room name / {r} - doors, chests and devices',
    '{x} - first / third person / {plus} - pause and map / Hold {minus} to skip cinematics',
    'Recover your gear and search Branden and Brendan\'s rooms'],
  basics: ['Left stick - walk / Hold {zl} - sprint / Right stick - look',
    '{b} - jump / {y} - crouch (slide tackle while moving forward) / {r} - interact',
    'Hold {l} - weapons / Right stick - select / Release {l} - equip / {a} - attack',
    '{zr} - goggles / D-pad Right - dance / {x} - view / {plus} - pause / Hold {minus} to skip cinematics'],
  pistol: ['Hold {l}, select pistol with the right stick, release {l} to equip', 'Select Unarmed to holster / {a} - shoot at your crosshair'],
  crowbar: ['Hold {l}, select crowbar with the right stick, release {l} to equip', 'Select Unarmed to holster / {a} - swing'],
  lightsaber: ['Hold {l}, select lightsaber with the right stick, release {l} to equip', 'Select Unarmed to holster / {a} - slash'],
  teleport: ['D-pad Down - place purple anchor', 'D-pad Up - teleport to your anchor'],
  goggles: ['{zr} - wear / remove scanner goggles'],
  vent: ['Left stick - move / Hold {zl} - faster crawl', 'Explore the branches to find the camera-room exit', 'Wait for green sensors / Blue pads are checkpoints'],
  cargo: ['{r} - grab / release a nearby box', 'Left stick - move while holding it'],
  flight: ['Left stick - steer / Right stick - aim', 'Hold {a} - fire / {b} - evade / {r} - activate collected shield',
    '{x} - cockpit / chase camera / {plus} - pause / {minus} - skip VS intro'],
  flightSide: ['Left stick - move / Hold {a} - fire straight', 'Stick up / down + {b} - vertical dodge'],
  flightTop: ['Left stick - move / Hold {a} - fire upward', 'Stick left / right + {b} - lateral dodge'],
  jungle: ['Left stick - walk / Right stick - look / Hold {zl} - sprint / {b} - jump',
    '{y} while moving forward - slide tackle; otherwise crouch',
    'Hold {l} + right stick - select weapon / {a} - attack / {x} - view'],
  platformer: ['Left stick - move / {b} - jump / Hold {zl} - sprint / {y} - crouch',
    'Right stick - aim / Hold {l} + right stick - weapons / {a} - attack / D-pad Left - retry'],
  finale: ['Left stick - move (up / down changes altitude in space)',
    '{a} - sword chain / {x} - rifle salvo / Hold {zl} - shield and parry',
    '{b} - dodge boost / {r} - Last Light (18-second recharge) / {plus} - pause / Hold {minus} - skip intro',
    'QTE: press the displayed controller control; mash {y} for blade lock and hold {r} to charge',
    'D-pad Left - execution-shot evade / retry after defeat / D-pad Up - ascend'],
};

function buttonDown(pad: Gamepad, binding: ButtonBinding) {
  if ('button' in binding) return !!pad.buttons[binding.button]?.pressed || (pad.buttons[binding.button]?.value ?? 0) >= 0.55;
  const value = pad.axes[binding.axis] ?? binding.neutral;
  return binding.trigger ? (value - binding.neutral) / (binding.value - binding.neutral) >= 0.55
    : Math.abs(value - binding.value) < 0.08;
}
function readStick(pad: Gamepad, x: AxisBinding, y: AxisBinding) {
  return controllerStick(((pad.axes[x.axis] ?? x.neutral) - x.neutral) * x.sign,
    ((pad.axes[y.axis] ?? y.neutral) - y.neutral) * y.sign);
}
function dispatch(event: Event) {
  controllerEvents.add(event);
  // Dispatch from document so both document-owned weapons and window-owned scenes receive input.
  document.dispatchEvent(event);
}
function keyEvent(code: string, pressed: boolean) {
  dispatch(new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
    code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code,
    bubbles: true, cancelable: true,
  }));
}

export function createGamepadInput(options: GamepadInputOptions) {
  const listeners = new AbortController();
  const layouts = new Map<string, ControllerLayout>();
  const swappedButtons = new Map<string, boolean>();
  const heldKeys = new Set<string>(), blockedButtons = new Set<ControllerButton>();
  let pad: Gamepad | null = null, layout: ControllerLayout | null = null;
  let previousButtons = new Set<ControllerButton>(), currentButtons = new Set<ControllerButton>();
  let fireHeld = false, resetting = false;
  let inputEpoch = 0;
  let cursorX = 0, cursorY = 0, lastContext = '', lastStatus = '', navDirection = '', navTime = 0;
  let disposed = false, blurred = false, failure = '';
  type AxisName = 'leftX' | 'leftY' | 'rightX' | 'rightY';
  const axisSteps: { name: AxisName; text: string; sign: number }[] = [
    { name: 'leftX', text: 'Push the LEFT stick fully RIGHT', sign: 1 },
    { name: 'leftY', text: 'Push the LEFT stick fully UP', sign: -1 },
    { name: 'rightX', text: 'Push the RIGHT stick fully RIGHT', sign: 1 },
    { name: 'rightY', text: 'Push the RIGHT stick fully UP', sign: -1 },
  ];
  type SetupStep = { kind: 'button'; name: ControllerButton }
    | { kind: 'axis'; name: AxisName; text: string; sign: number };
  let setup: { index: number; steps: SetupStep[]; neutral: number[]; previousMode: InputMode;
    buttons: Partial<Record<ControllerButton, ButtonBinding>>;
    axes: Partial<Record<AxisName, AxisBinding>>;
    wait: boolean; error: string } | null = null;

  function status(): ControllerStatus {
    const capable = !!pad && pad.axes.length >= 4 && pad.buttons.length >= 10;
    const step = setup?.steps[setup.index];
    const instruction = step?.kind === 'button' ? `Press ${controllerButtonLabel(step.name)}` : step?.text ?? '';
    const key = layoutKey();
    return { mode, type: controllerType, name: pad?.id ?? null, ready: !!controllerType && !!layout && !setup && !failure,
      canSetup: capable && !!controllerType && !failure, swapAB: !!key && !!swappedButtons.get(key),
      message: failure || (!controllerType ? 'Pick Switch, Xbox or PlayStation below, then select the Controller tab to enable it.'
        : !pad ? 'No controller detected. Plug it in, then press a controller button to let the browser detect it.'
        : !capable ? 'Controller detected, but this layout needs two sticks and the game action buttons.'
          : setup ? `Controller setup: follow each prompt using the physical ${profiles[controllerType].name} button labels.`
            : !layout ? 'Controller detected without a standard browser mapping. Center both sticks, release all buttons, then choose Calibrate game controls.'
              : `${profiles[controllerType].name} profile selected. ${mode === 'controller' ? 'Controller input is active.' : 'Keyboard & mouse remain active until you select Controller.'}`),
      setupStep: setup ? `${setup.index + 1} / ${setup.steps.length}: ${setup.error || (setup.wait ? 'Release the control and center both sticks' : instruction)}` : null };
  }
  function notifyStatus() {
    const next = status(), signature = JSON.stringify(next);
    if (signature === lastStatus) return;
    lastStatus = signature; options.onStatus(next);
  }
  function setKey(code: string, down: boolean) {
    if (down === heldKeys.has(code)) return;
    if (down) heldKeys.add(code); else heldKeys.delete(code);
    keyEvent(code, down);
  }
  function mouseButton(down: boolean, cancelled = false) {
    if (fireHeld === down) return;
    fireHeld = down;
    const init = { button: 0, buttons: down ? 1 : 0, bubbles: true, cancelable: true,
      clientX: (cursorX + 1) * window.innerWidth / 2, clientY: (cursorY + 1) * window.innerHeight / 2 };
    const pointer = new PointerEvent(down ? 'pointerdown' : 'pointerup', { ...init, pointerId: 1, pointerType: 'mouse' });
    dispatch(pointer);
    if (!pointer.defaultPrevented || !down) dispatch(new MouseEvent(down ? 'mousedown' : 'mouseup', init));
    if (!down && !cancelled) dispatch(new MouseEvent('click', init));
  }
  function reset(preserveWheel = false) {
    if (resetting) return;
    resetting = true;
    inputEpoch++;
    if (!preserveWheel && heldKeys.has('Tab')) options.cancelWheel();
    for (const code of [...heldKeys]) if (!preserveWheel || code !== 'Tab') setKey(code, false);
    mouseButton(false, true);
    movement = { x: 0, y: 0 };
    cursorX = cursorY = 0; navDirection = ''; navTime = 0;
    // One-shot actions need a fresh press; held movement, sprint, guard and wheel do not.
    for (const button of currentButtons) if (button !== 'l' && button !== 'zl') blockedButtons.add(button);
    resetting = false;
  }
  function setMode(next: InputMode) {
    if (next === 'controller' && !status().ready) {
      options.onNotice(status().message); notifyStatus(); return false;
    }
    if (next === mode) return true;
    mode = next; reset(); options.onModeChange(mode); notifyStatus();
    return true;
  }
  function poll() {
    if (failure || disposed) return;
    if (typeof navigator.getGamepads !== 'function') { failure = 'This browser does not support USB controllers (Gamepad API). Use a current Chrome, Edge or Firefox browser.'; notifyStatus(); return; }
    let connected: Gamepad[];
    try { connected = Array.from(navigator.getGamepads()).filter((item): item is Gamepad => !!item?.connected); }
    catch (error) {
      console.error('[Controller] Gamepad access failed:', error);
      failure = 'The browser blocked controller access. Allow gamepad access or open the game directly on HTTPS / localhost.';
      setMode('keyboard'); notifyStatus(); return;
    }
    const previous = pad;
    const retained = connected.find(item => item.index === pad?.index && item.id === pad?.id);
    if (previous && !retained) {
      setMode('keyboard'); reset(); setup = null;
      options.onNotice('Controller disconnected. Keyboard & mouse restored.');
    }
    pad = retained ?? connected.find(item => item.mapping === 'standard' && item.axes.length >= 4 && item.buttons.length >= 16) ?? connected[0] ?? null;
    refreshLayout();
    if (pad && (pad.id !== previous?.id || pad.index !== previous?.index)) {
      previousButtons.clear(); currentButtons.clear(); blockedButtons.clear(); reset();
      options.onNotice('Controller detected. Open M > Controls, pick Switch, Xbox or PlayStation, then select Controller.');
    }
    notifyStatus();
  }
  function refreshLayout() {
    const key = layoutKey();
    const base = pad && key ? layouts.get(key) ?? (pad.mapping === 'standard' && pad.axes.length >= 4 && pad.buttons.length >= 16
      ? standardLayout : null) : null;
    layout = base && key && swappedButtons.get(key)
      ? { ...base, buttons: { ...base.buttons, a: base.buttons.b, b: base.buttons.a } } : base;
  }
  function layoutKey() { return pad && controllerType ? `${controllerType}:${pad.id}` : null; }
  function setControllerType(type: ControllerType) {
    if (type === controllerType) return;
    reset(); setup = null; controllerType = type; refreshLayout();
    currentButtons = pad && layout ? new Set(BUTTONS.filter(button => buttonDown(pad!, layout!.buttons[button]))) : new Set();
    previousButtons = new Set(currentButtons); reset();
    if (isControllerActive() && !status().ready) setMode('keyboard');
    notifyStatus();
  }
  function setSwapAB(swapped: boolean) {
    const key = layoutKey();
    if (!pad || !layout || !key || setup) { options.onNotice(status().message); return; }
    reset(); swappedButtons.set(key, swapped); refreshLayout();
    currentButtons = new Set(BUTTONS.filter(button => buttonDown(pad!, layout!.buttons[button])));
    previousButtons = new Set(currentButtons); reset(); notifyStatus();
  }
  function beginSetup() {
    if (!pad || !status().canSetup) { options.onNotice(status().message); return; }
    const previousMode = mode;
    setMode('keyboard'); reset();
    const steps: SetupStep[] = BUTTONS.map(name => ({ kind: 'button', name }));
    steps.push(...axisSteps.map(step => ({ ...step, kind: 'axis' as const })));
    setup = { index: 0, steps, neutral: [...pad.axes], previousMode, buttons: {}, axes: {}, wait: true, error: '' };
    notifyStatus();
  }
  function cancelSetup() {
    if (!setup) return;
    const previousMode = setup.previousMode;
    setup = null; reset();
    if (previousMode === 'controller' && status().ready) setMode('controller');
    notifyStatus();
  }
  function advanceSetup() {
    if (!setup || !pad) return;
    setup.index++; setup.wait = true; setup.error = '';
    if (setup.index === setup.steps.length) finishSetup();
    notifyStatus();
  }
  function finishSetup() {
    if (!setup || !pad) return;
    const requiredButton = (name: ControllerButton) => {
      const binding = setup!.buttons[name];
      if (!binding) throw new Error(`Controller setup is missing ${name}`);
      return binding;
    };
    const requiredAxis = (name: AxisName) => {
      const binding = setup!.axes[name];
      if (!binding) throw new Error(`Controller setup is missing ${name}`);
      return binding;
    };
    layout = { buttons: { b: requiredButton('b'), a: requiredButton('a'), y: requiredButton('y'), x: requiredButton('x'),
      l: requiredButton('l'), r: requiredButton('r'), zl: requiredButton('zl'), zr: requiredButton('zr'),
      minus: requiredButton('minus'), plus: requiredButton('plus'),
      up: requiredButton('up'), down: requiredButton('down'), left: requiredButton('left'), right: requiredButton('right') },
    leftX: requiredAxis('leftX'), leftY: requiredAxis('leftY'), rightX: requiredAxis('rightX'), rightY: requiredAxis('rightY') };
    const key = layoutKey();
    if (!key) throw new Error('Controller type was not selected before setup');
    layouts.set(key, layout); swappedButtons.delete(key); setup = null; reset(); setMode('controller');
    options.onNotice('Game controls and both sticks are calibrated. Controller input is active.');
  }
  function updateSetup() {
    if (!setup || !pad) return;
    const neutral = !pad.buttons.some(button => button.pressed || button.value > 0.3)
      && pad.axes.every((value, index) => Math.abs(value - setup!.neutral[index]) < 0.15);
    if (setup.wait) { if (neutral) { setup.wait = false; setup.error = ''; notifyStatus(); } return; }
    const step = setup.steps[setup.index];
    if (step.kind === 'button') {
      const name = step.name, button = pad.buttons.findIndex(item => item.pressed || item.value >= 0.65);
      const axis = pad.axes.findIndex((value, index) => Math.abs(value - setup!.neutral[index]) >= 0.5);
      const binding: ButtonBinding | null = button >= 0 ? { button } : axis >= 0
        ? { axis, value: pad.axes[axis], neutral: setup.neutral[axis], trigger: name === 'zl' || name === 'zr' } : null;
      if (!binding) return;
      if (Object.values(setup.buttons).some(existing => 'button' in binding && 'button' in existing
        ? binding.button === existing.button : 'axis' in binding && 'axis' in existing
          && binding.axis === existing.axis && Math.abs(binding.value - existing.value) < 0.08)) {
        setup.error = 'That control is already assigned. Release it, then press the requested control.';
        setup.wait = true; notifyStatus(); return;
      }
      setup.buttons[name] = binding;
    } else {
      const axis = pad.axes.findIndex((value, index) => Math.abs(value - setup!.neutral[index]) >= 0.65);
      if (axis < 0) return;
      if (Object.values(setup.axes).some(existing => existing.axis === axis)
        || Object.values(setup.buttons).some(existing => 'axis' in existing && existing.axis === axis)) {
        setup.error = 'That axis is already assigned. Release it, then move the requested stick.';
        setup.wait = true; notifyStatus(); return;
      }
      setup.axes[step.name] = { axis, sign: Math.sign(pad.axes[axis] - setup.neutral[axis]) * step.sign, neutral: setup.neutral[axis] };
    }
    advanceSetup();
  }
  function update(delta: number) {
    poll();
    if (setup) { if (!document.hidden && !blurred) updateSetup(); return; }
    if (!pad || !layout || !isControllerActive() || disposed) return;
    currentButtons = new Set(BUTTONS.filter(button => buttonDown(pad!, layout!.buttons[button])));
    for (const button of blockedButtons) if (!currentButtons.has(button)) blockedButtons.delete(button);
    const down = (button: ControllerButton) => currentButtons.has(button) && !blockedButtons.has(button);
    const pressed = (button: ControllerButton) => down(button) && !previousButtons.has(button);
    const profile = profiles[controllerType ?? 'switch'];
    const context = options.getContext(), signature = contextSignature(context);
    if (signature !== lastContext) { lastContext = signature; reset(context.wheelOpen); }
    const left = readStick(pad, layout.leftX, layout.leftY), right = readStick(pad, layout.rightX, layout.rightY);
    const look = right;
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.05)) : 0;
    if (document.hidden || blurred) { reset(); previousButtons = new Set(currentButtons); return; }
    if (pressed('plus')) {
      previousButtons = new Set(currentButtons); options.onMenuAction('pause'); return;
    }
    if (context.menuOpen) {
      if (pressed(profile.confirm)) options.onMenuAction('confirm');
      else if (pressed(profile.cancel)) options.onMenuAction('back');
      else {
        const direction = down('up') || left.y < -0.55 ? 'up' : down('down') || left.y > 0.55 ? 'down'
          : down('left') || left.x < -0.55 ? 'left' : down('right') || left.x > 0.55 ? 'right' : '';
        if (direction !== navDirection) { navDirection = direction; navTime = 0; if (direction) options.onMenuAction(direction); }
        else if (direction) { navTime += dt; if (navTime >= 0.35) { options.onMenuAction(direction); navTime -= 0.12; } }
      }
      movement = { x: 0, y: 0 };
    } else if (context.wheelOpen) {
      movement = { x: 0, y: 0 };
      if (pressed(profile.cancel)) { options.cancelWheel(); blockedButtons.add('l'); }
      else {
        options.aimWheel(look.x, look.y);
        setKey('Tab', down('l'));
      }
      if (!options.getContext().wheelOpen) {
        const resumed = options.getContext();
        lastContext = contextSignature(resumed);
        if (!resumed.menuOpen) applyGameplay(resumed.kind);
      }
    } else applyGameplay(context.kind);
    previousButtons = new Set(currentButtons);

    function applyGameplay(kind: ControllerContext) {
      const epoch = inputEpoch;
      const desired = new Set<string>();
      movement = left;
      if (['foot', 'flight', 'platformer', 'finale'].includes(kind)) {
        if (movement.y < -0.25) desired.add('KeyW');
        if (movement.y > 0.25) desired.add('KeyS');
        if (movement.x < -0.25) desired.add('KeyA');
        if (movement.x > 0.25) desired.add('KeyD');
      } else movement = { x: 0, y: 0 };
      for (const button of BUTTONS) {
        const code = kind === 'inspection' && button === profile.cancel ? 'Escape'
          : kind === 'inspection' && button === 'b' ? undefined : contextKeys[kind][button];
        if (code && down(button)) desired.add(code);
      }
      for (const code of [...heldKeys]) if (!desired.has(code)) setKey(code, false);
      for (const code of desired) {
        setKey(code, true);
        if (epoch !== inputEpoch) break;
      }
      if (epoch === inputEpoch && !options.getContext().wheelOpen && ['foot', 'flight', 'platformer', 'inspection', 'cinematic'].includes(kind)) {
        if (kind !== 'cinematic' && (look.x || look.y)) {
          const dx = look.x * Math.abs(look.x) * 900 * dt, dy = look.y * Math.abs(look.y) * 900 * dt;
          cursorX = Math.max(-0.96, Math.min(0.96, cursorX + dx * 2 / window.innerWidth));
          cursorY = Math.max(-0.96, Math.min(0.96, cursorY + dy * 2 / window.innerHeight));
          const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true,
            clientX: (cursorX + 1) * window.innerWidth / 2, clientY: (cursorY + 1) * window.innerHeight / 2 });
          Object.defineProperties(event, { movementX: { value: dx }, movementY: { value: dy } });
          dispatch(event);
        }
        mouseButton(down(kind === 'inspection' ? profile.confirm : 'a'));
      }
    }
  }
  function contextSignature(context: ReturnType<GamepadInputOptions['getContext']>) {
    return `${context.id}:${context.kind}:${context.menuOpen}:${context.wheelOpen}`;
  }
  const capture = { capture: true, signal: listeners.signal };
  const gate = (event: Event) => {
    if (!isControllerActive() || isControllerEvent(event)) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    if (event instanceof KeyboardEvent && (event.code === 'KeyM' || event.code === 'Escape')) return;
    if (options.getContext().menuOpen) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  for (const type of ['keydown', 'keyup', 'mousemove', 'mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup']) {
    window.addEventListener(type, gate, capture);
  }
  window.addEventListener('blur', () => { blurred = true; reset(); }, { signal: listeners.signal });
  window.addEventListener('focus', () => { blurred = false; reset(); }, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, { signal: listeners.signal });
  for (const type of ['gamepadconnected', 'gamepaddisconnected']) window.addEventListener(type, () => { failure = ''; poll(); }, { signal: listeners.signal });
  const resetFromScene = () => reset(options.getContext().wheelOpen);
  resetActiveInput = resetFromScene;
  poll();
  return { update, reset, setMode, setControllerType, setSwapAB, beginSetup, cancelSetup, getStatus: status,
    dispose() {
      if (disposed) return;
      setMode('keyboard'); reset(); listeners.abort(); disposed = true;
      controllerType = null;
      if (resetActiveInput === resetFromScene) resetActiveInput = null;
    } };
}
