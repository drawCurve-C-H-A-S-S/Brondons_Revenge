/**
 * Hold-to-deploy interaction — phase 4 round 2a. A small, self-contained hold handler modelled on
 * createHoldToSkip (which is left untouched): hold a key for `holdSeconds` while `isAvailable()` is true
 * to fire `onDeploy`; releasing early resets progress. It drives a dedicated prompt element with a
 * progress fill so it never competes for the shared #interact-prompt / ownsPrompt convention.
 */
export function createHoldToDeploy({ holdSeconds, key = 'KeyE', onDeploy, isAvailable = () => true, isPaused = () => false, prompt = null, fill = null }: {
  holdSeconds: number;
  key?: string;
  onDeploy: () => void;
  isAvailable?: () => boolean;
  isPaused?: () => boolean;
  prompt?: HTMLElement | null;
  fill?: HTMLElement | null;
}) {
  let held = false, elapsed = 0, completed = false, disposed = false;

  function setFill(progress: number) {
    if (fill) fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
  }
  function reset() { held = completed = false; elapsed = 0; setFill(0); }
  function available() {
    return !disposed && !document.hidden && !isPaused() && isAvailable()
      && !document.body.classList.contains('quick-menu-open') && !document.body.classList.contains('space-paused');
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== key) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!available()) { reset(); return; }
    event.preventDefault();
    if (!event.repeat && !completed) held = true;
  }
  function onKeyUp(event: KeyboardEvent) { if (event.code === key) reset(); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  reset();

  return {
    reset,
    get holding() { return held && !completed; },
    get progress() { return elapsed / Math.max(0.0001, holdSeconds); },
    update(delta: number) {
      const isAvailableNow = available();
      if (prompt) prompt.classList.toggle('hidden', !isAvailableNow);
      if (!isAvailableNow) { reset(); return; }
      if (!held || completed) { setFill(0); return; }
      elapsed = Math.min(holdSeconds, elapsed + (Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0));
      setFill(elapsed / holdSeconds);
      if (elapsed >= holdSeconds) { completed = true; held = false; onDeploy(); }
    },
    dispose() {
      disposed = true; reset();
      if (prompt) prompt.classList.add('hidden');
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    },
  };
}

export type HoldToDeploy = ReturnType<typeof createHoldToDeploy>;
