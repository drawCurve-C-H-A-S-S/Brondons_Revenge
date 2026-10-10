export type WeaponId = 'unarmed' | 'pistol' | 'crowbar' | 'lightsaber';
export interface WeaponWheelEntry { id: WeaponId; label: string; }
interface WeaponWheelOptions {
  getEntries: () => WeaponWheelEntry[];
  getCurrentId: () => WeaponId;
  isBlocked: () => boolean;
  setPaused: (paused: boolean) => void;
  onSelect: (id: WeaponId) => void;
  getTapAction?: () => (() => void) | null;
}
const TAU = Math.PI * 2;
const RADIUS = 112;
const DEAD_ZONE = 32;
const icons: Record<WeaponId, string> = {
  unarmed: 'M-12 -8L12 8M-12 8L12 -8',
  pistol: 'M-20 -10H18V1H4L0 18H-12L-8 1H-20ZM-6 1H3',
  crowbar: 'M-13 18L6 -12Q13 -22 20 -12L17 -6M-17 15L-11 20',
  lightsaber: 'M-15 18L-6 8M-18 15L-9 5M-7 7L16 -16Q20 -21 23 -17L0 10M-10 3L3 16',
};

/** Nearest radial segment, with a central cancellation zone. Coordinates are SVG units. */
export function weaponWheelIndex(x: number, y: number, count: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || count < 1 || Math.hypot(x, y) < DEAD_ZONE) return -1;
  const angle = (Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU;
  return Math.round(angle / (TAU / count)) % count;
}

/** Hold Tab, aim, release to equip. Capture-phase input keeps every scene frozen. */
export function createWeaponWheel(options: WeaponWheelOptions) {
  const events = new AbortController();
  const root = document.createElement('section');
  root.id = 'weapon-wheel'; root.className = 'hidden';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Weapons'); root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<div class="ww-heading">EQUIPMENT<span>WEAPONS</span></div>
    <svg viewBox="-190 -190 380 380" aria-hidden="true">
      <circle class="ww-ring" r="112"/><g class="ww-nodes"></g>
      <line class="ww-line" x1="0" y1="0" x2="0" y2="0"/>
      <circle class="ww-hub" r="5"/><circle class="ww-cursor" r="4"/>
    </svg>
    <div class="ww-selection" role="status" aria-live="polite"></div>
    <div class="ww-hint">Hold <kbd>Tab</kbd> &nbsp; Aim to select &nbsp; Release to equip<br>Unarmed to holster &nbsp; / &nbsp; Esc to cancel</div>`;
  document.body.appendChild(root);
  const svg = root.querySelector('svg')!;
  const nodes = root.querySelector('.ww-nodes')!;
  const line = root.querySelector('.ww-line')!;
  const cursor = root.querySelector('.ww-cursor')!;
  const label = root.querySelector('.ww-selection')!;
  let open = false, selected = -1, x = 0, y = 0;
  let entries: WeaponWheelEntry[] = [];
  let positions: { x: number; y: number }[] = [];
  let sourceEntries: Element[] = [];
  let holdTimer: ReturnType<typeof setTimeout> | null = null, tapAction: (() => void) | null = null;

  function cancelHold() {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null; tapAction = null;
  }

  function select(index: number) {
    selected = index;
    sourceEntries.forEach((node, i) => node.classList.toggle('selected', i === index));
    const point = positions[index];
    const lineScale = (RADIUS - 40) / RADIUS;
    line.setAttribute('x2', String((point?.x ?? 0) * lineScale)); line.setAttribute('y2', String((point?.y ?? 0) * lineScale));
    line.classList.toggle('active', !!point);
    label.textContent = entries[index]?.label ?? 'Keep current weapon';
  }
  function openWheel() {
    if (open || options.isBlocked()) return false;
    entries = options.getEntries();
    if (!entries.length) return false;
    positions = entries.map((_, i) => ({ x: Math.sin(i * TAU / entries.length) * RADIUS, y: -Math.cos(i * TAU / entries.length) * RADIUS }));
    nodes.innerHTML = entries.map((entry, i) => {
      const point = positions[i];
      return `<g class="ww-node${entry.id === options.getCurrentId() ? ' equipped' : ''}" data-weapon="${entry.id}" transform="translate(${point.x},${point.y})">
        <circle r="38"/><path class="ww-icon" d="${icons[entry.id]}"/>
        <text y="55" text-anchor="middle">${entry.label}</text></g>`;
    }).join('');
    sourceEntries = Array.from(nodes.children);
    x = y = 0; cursor.setAttribute('cx', '0'); cursor.setAttribute('cy', '0'); select(-1);
    open = true; root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('weapon-wheel-open');
    // Keep pointer lock. Relative mouse motion drives a virtual cursor without moving the camera.
    root.classList.toggle('locked-pointer', !!document.pointerLockElement);
    options.setPaused(true);
    root.querySelector('.ww-hint')!.innerHTML = isControllerActive()
      ? `Hold <kbd>${controllerButtonLabel('l')}</kbd> &nbsp; Right stick to select &nbsp; Release to equip<br>Unarmed to holster &nbsp; / &nbsp; ${controllerMenuLabel('back')} to cancel`
      : 'Hold <kbd>Tab</kbd> &nbsp; Aim to select &nbsp; Release to equip<br>Unarmed to holster &nbsp; / &nbsp; Esc to cancel';
    return true;
  }
  function close(confirm = false) {
    cancelHold();
    if (!open) return;
    const choice = confirm ? entries[selected] : undefined;
    open = false; root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('weapon-wheel-open');
    options.setPaused(false);
    if (choice) options.onSelect(choice.id);
    select(-1);
  }
  function consume(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function point(event: MouseEvent) {
    const bounds = svg.getBoundingClientRect(), scale = 380 / Math.max(1, bounds.width);
    if (document.pointerLockElement) {
      x += event.movementX * scale; y += event.movementY * scale;
    } else {
      x = (event.clientX - bounds.left - bounds.width / 2) * scale;
      y = (event.clientY - bounds.top - bounds.height / 2) * scale;
    }
    const distance = Math.hypot(x, y);
    if (distance > 154) { x *= 154 / distance; y *= 154 / distance; }
    cursor.setAttribute('cx', String(x)); cursor.setAttribute('cy', String(y));
    select(weaponWheelIndex(x, y, entries.length));
  }
  function aimFromStick(stickX: number, stickY: number) {
    if (!open || Math.hypot(stickX, stickY) < 0.2) return;
    x = stickX * RADIUS; y = stickY * RADIUS;
    cursor.setAttribute('cx', String(x)); cursor.setAttribute('cy', String(y));
    select(weaponWheelIndex(x, y, entries.length));
  }
  const capture = { capture: true, signal: events.signal };
  window.addEventListener('keydown', event => {
    if (isControllerActive() && !isControllerEvent(event) && event.code !== 'Escape') return;
    if (open) {
      consume(event);
      if (event.code === 'Escape') close();
      else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.code)) {
        const step = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
        select(selected < 0 ? (step > 0 ? 0 : entries.length - 1) : (selected + step + entries.length) % entries.length);
      }
      return;
    }
    if (event.code !== 'Tab' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    if (options.isBlocked()) return;
    tapAction = options.getTapAction?.() ?? null;
    if (tapAction) {
      consume(event);
      holdTimer = setTimeout(() => { holdTimer = null; tapAction = null; openWheel(); }, 230);
    } else if (openWheel()) consume(event);
  }, capture);
  window.addEventListener('keyup', event => {
    if (isControllerActive() && !isControllerEvent(event)) return;
    if (event.code === 'Tab' && holdTimer !== null) {
      const action = tapAction; cancelHold(); consume(event);
      if (!options.isBlocked()) action?.();
      return;
    }
    if (!open) return;
    consume(event);
    if (event.code === 'Tab') close(true);
  }, capture);
  window.addEventListener('mousemove', event => { if (open) { if (!isControllerActive()) point(event); consume(event); } }, capture);
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend'] as const) {
    window.addEventListener(type, event => { if (open) consume(event); }, { ...capture, passive: false });
  }
  window.addEventListener('blur', () => close(), { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); }, { signal: events.signal });
  document.addEventListener('pointerlockchange', () => { if (open && !document.pointerLockElement && !isControllerActive()) close(); }, { signal: events.signal });
  return { isOpen: () => open, close, aimFromStick, dispose() { close(); events.abort(); root.remove(); } };
}
import { isControllerActive, isControllerEvent, controllerButtonLabel, controllerMenuLabel } from './gamepadInput.js';
