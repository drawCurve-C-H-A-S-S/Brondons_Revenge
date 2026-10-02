export const SKIP_HOLD_SECONDS = 1.1;

export function createHoldToSkip({ button, onSkip, isAvailable = () => true, isPaused = () => false }: {
  button: HTMLButtonElement;
  onSkip: () => void;
  isAvailable?: () => boolean;
  isPaused?: () => boolean;
}) {
  let held = false, elapsed = 0, completed = false, disposed = false;
  button.classList.add('hold-to-skip');
  button.textContent = 'Hold Enter to skip';
  button.title = 'Hold Enter for 1.1 seconds to skip';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-keyshortcuts', 'Enter');

  function reset() {
    held = completed = false; elapsed = 0;
    button.style.setProperty('--skip-progress', '0');
  }
  function available() {
    return !disposed && !document.hidden && !isPaused() && isAvailable() && !button.disabled
      && !button.classList.contains('hidden') && !document.body.classList.contains('quick-menu-open');
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!available()) { reset(); return; }
    event.preventDefault();
    if (!event.repeat && !completed) held = true;
  }
  function onKeyUp(event: KeyboardEvent) {
    if (event.code === 'Enter' || event.code === 'NumpadEnter') reset();
  }
  function onClick(event: MouseEvent) { event.preventDefault(); }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  button.addEventListener('click', onClick);
  reset();

  return {
    reset,
    update(delta: number) {
      if (!available()) { reset(); return; }
      if (!held || completed) return;
      elapsed = Math.min(SKIP_HOLD_SECONDS, elapsed + (Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0));
      button.style.setProperty('--skip-progress', String(elapsed / SKIP_HOLD_SECONDS));
      if (elapsed >= SKIP_HOLD_SECONDS) { completed = true; held = false; onSkip(); }
    },
    dispose() {
      disposed = true; reset();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
      button.removeEventListener('click', onClick);
    },
  };
}