/**
 * Phase 4 (Bay Warden zero-G barrage) hologram BOOT TERMINAL — round 2b. Additive; only scene13 phase 4
 * ever constructs this. Replaces the old hold-E decoy deploy with a typing puzzle: float to a station,
 * press E, and type its target line to boot a hologram. Booting BOTH stations breaks the AI's overfit
 * BRONDON-detection model.
 *
 * INPUT CAPTURE (approved design). While open, a single WINDOW keydown listener registered with
 * capture:true calls preventDefault() + stopImmediatePropagation() for EVERY key, so typing never reaches
 * the bubble-phase handlers that drive movement (player.ts), weapons/lightsaber/parry, or scene shortcuts.
 * Mouse is blocked the same way (mousedown/mouseup/click/contextmenu/wheel captured + stopped) so a key
 * never fires a weapon. The one global shortcut that also listens in the CAPTURE phase is main.ts's KeyM
 * (pause); capture listeners on the same node run in registration order and main.ts registers first, so it
 * would win — EXCEPT it skips KeyM whenever the event target is an editable field. We therefore keep a
 * visually-hidden <input type="text"> focused for the whole time the terminal is open: that focused field
 * makes main.ts's `editing` guard true and neutralizes KeyM. Typed progress is kept per station across
 * Esc/close (approved), so a player can float between stations without losing their place.
 *
 * scene13 owns the time slowdown (a `terminal` source in its Math.min timeScale) and clears the player's
 * queued zero-G taps every frame while this is open, so thrusters are effectively disabled mid-type.
 */
export interface Phase4TerminalOptions {
  overlay: HTMLElement | null;
  input: HTMLInputElement | null;
  targetEl: HTMLElement | null;
  typedEl: HTMLElement | null;
  stationEl: HTMLElement | null;
  /** Target line per station index (from PHASE4_RULES.terminalLines). */
  lines: readonly string[];
  /** Fired once when Enter is pressed on a fully-correct line; the caller boots that station. */
  onCompile: (stationIndex: number) => void;
  /** Optional hook for a wrong-line Enter (sound / shake). */
  onError?: (stationIndex: number) => void;
}

// Capture-phase mouse events blocked while typing (mousemove is deliberately NOT blocked: the approved
// design lets the player keep looking around the bay while the terminal is open).
const BLOCKED_MOUSE = ['mousedown', 'mouseup', 'click', 'contextmenu', 'wheel'] as const;

export function createPhase4Terminal(options: Phase4TerminalOptions) {
  const { overlay, input, targetEl, typedEl, stationEl, lines, onCompile, onError } = options;
  // Kept typed text per station so Esc/close preserves progress (approved answer 5).
  const saved: string[] = lines.map(() => '');
  let open = false, disposed = false, stationIndex = -1, target = '', typed = '';

  function progressOf(str: string, line: string) {
    if (!line.length) return 0;
    let correct = 0;
    const len = Math.min(str.length, line.length);
    for (let i = 0; i < len; i++) if (str[i] === line[i]) correct++;
    return correct / line.length;
  }
  function isCorrect() { return target.length > 0 && typed === target; }

  function render() {
    if (stationIndex >= 0) saved[stationIndex] = typed;
    if (targetEl) targetEl.textContent = target;
    if (!typedEl) return;
    // Rebuild the typed line with a per-character correct/incorrect highlight (only on key events).
    typedEl.textContent = '';
    for (let i = 0; i < typed.length; i++) {
      const span = document.createElement('span');
      span.textContent = typed[i] === ' ' ? '\u00A0' : typed[i];
      span.className = typed[i] === target[i] ? 'p4-term-ok' : 'p4-term-bad';
      typedEl.appendChild(span);
    }
    const caret = document.createElement('span');
    caret.className = 'p4-term-caret'; caret.textContent = '\u00A0';
    typedEl.appendChild(caret);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!open || disposed) return;   // closed: pass every key through untouched (normal gameplay)
    // Preempt ALL other key handling (movement, weapons, scene shortcuts). The focused <input> separately
    // disarms main.ts's capture-phase KeyM pause via its editing guard.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'Escape') { close(); return; }
    if (event.code === 'Enter') {
      if (isCorrect()) { const idx = stationIndex; typed = ''; if (idx >= 0) saved[idx] = ''; close(); onCompile(idx); }
      else onError?.(stationIndex);
      return;
    }
    if (event.code === 'Backspace') { typed = typed.slice(0, -1); render(); return; }
    if (event.repeat) return;   // no auto-repeat for printable keys (Backspace above may repeat)
    // Any single printable character (includes shifted symbols like " ( ) # and space via e.key).
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { typed += event.key; render(); }
  }
  function blockMouse(event: Event) {
    if (!open || disposed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function attach() {
    window.addEventListener('keydown', onKeyDown, true);
    for (const type of BLOCKED_MOUSE) window.addEventListener(type, blockMouse, { capture: true, passive: false });
  }
  function detach() {
    window.removeEventListener('keydown', onKeyDown, true);
    for (const type of BLOCKED_MOUSE) window.removeEventListener(type, blockMouse, true);
  }

  function openFor(index: number) {
    if (disposed || open || index < 0 || index >= lines.length) return;
    stationIndex = index; target = lines[index]; typed = saved[index] ?? '';
    if (typed.length > target.length) typed = typed.slice(0, target.length);
    open = true;
    if (stationEl) stationEl.textContent = String(index + 1);
    overlay?.classList.remove('hidden');
    render();
    if (input) { input.value = ''; input.focus({ preventScroll: true }); }
    // TODO(mobile): surface an on-screen keyboard here; touch devices have no physical keys to capture,
    // so the typing puzzle needs a tappable glyph pad wired to the same `typed` buffer.
  }
  function close() {
    if (!open) return;
    if (stationIndex >= 0) saved[stationIndex] = typed;
    open = false;
    overlay?.classList.add('hidden');
    if (input) input.blur();
  }

  attach();   // registered once; both handlers no-op while closed

  return {
    get isOpen() { return open; },
    get station() { return stationIndex; },
    openFor,
    close,
    /** 0..1 correct/total for a station's kept text — drives its activation ring even while closed. */
    progressFor(index: number) {
      if (index < 0 || index >= lines.length) return 0;
      return progressOf(open && index === stationIndex ? typed : saved[index], lines[index]);
    },
    isCorrect,
    /** Per-frame focus guard: keep the sink focused so main.ts's editing guard keeps suppressing KeyM. */
    tick() { if (open && !disposed && input && document.activeElement !== input) input.focus({ preventScroll: true }); },
    /** Wipe every station's kept text (blind-window reset / a fresh barrage). */
    clearAllProgress() { for (let i = 0; i < saved.length; i++) saved[i] = ''; if (!open) typed = ''; },
    dispose() { if (disposed) return; disposed = true; close(); detach(); },
  };
}

export type Phase4Terminal = ReturnType<typeof createPhase4Terminal>;
