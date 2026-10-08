import type { Player } from '../../scripts/player.js';

export interface CameraVisitOptions {
  title: string;
  player: Player;
  hasReturnMarker: () => boolean;
  onRestart: () => Promise<boolean>;
}

export function createCameraVisitUI({ title, player, hasReturnMarker, onRestart }: CameraVisitOptions) {
  const root = document.createElement('section'); root.className = 'camera-visit-ui';
  const heading = document.createElement('strong'); heading.textContent = title;
  const help = document.createElement('p');
  const restart = document.createElement('button'); restart.type = 'button';
  restart.textContent = 'R / Restart at surveillance checkpoint'; restart.className = 'hidden';
  root.append(heading, help, restart); document.body.append(root);
  let restarting = false, disposed = false;
  async function restartVisit() {
    if (disposed || restarting || hasReturnMarker()) return;
    restarting = true; player.disable(); help.textContent = 'Restarting the surveillance checkpoint...';
    try {
      if (!await onRestart()) throw new Error('The surveillance checkpoint transfer was cancelled');
    } catch (error) {
      if (disposed) return;
      console.error('[CameraVisit] Checkpoint restart failed:', error);
      help.textContent = 'Checkpoint could not be loaded. Press R to retry.'; player.enable(); restarting = false;
    }
  }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyR' || event.repeat || event.defaultPrevented || document.hidden
      || document.body.classList.contains('quick-menu-open') || !player.isEnabled() || hasReturnMarker()) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); void restartVisit();
  }
  restart.addEventListener('click', () => { void restartVisit(); }); window.addEventListener('keydown', onKey);
  return {
    setVisible(value: boolean) { root.classList.toggle('hidden', !value); },
    update() {
      if (disposed || restarting) return;
      const linked = hasReturnMarker();
      help.textContent = linked ? 'T: return to surveillance / Hold Tab: weapons / Q replaces your return marker'
        : 'Surveillance return marker lost. This room has no walking route back. Restart from the surveillance checkpoint.';
      restart.classList.toggle('hidden', linked);
    },
    dispose() { disposed = true; window.removeEventListener('keydown', onKey); root.remove(); },
  };
}
