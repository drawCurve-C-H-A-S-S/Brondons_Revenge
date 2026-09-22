import type { Player } from './player.js';

interface GogglesContext {
  player: Player | null;
  scene: { setGogglesActive?: (active: boolean) => void } | null;
  setCharacterEquipped: (active: boolean) => void;
}

/** Inventory belongs to the game session, never to a disposable room. */
export class GogglesController {
  private collected = false;
  private equipped = false;
  private previousScene: GogglesContext['scene'] = null;
  private previousActive = false;
  constructor(private context: () => GogglesContext) { window.addEventListener('keydown', this.onKeyDown); }
  isCollected() { return this.collected; }
  isEquipped() { return this.equipped; }
  collect() { this.collected = true; this.equipped = true; this.update(); }
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyN' || event.repeat || !this.collected || !this.context().player?.isEnabled()) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault(); this.equipped = !this.equipped; this.update();
  };
  update() {
    const { player, scene, setCharacterEquipped } = this.context();
    const active = this.equipped && !!player?.isEnabled();
    if (scene !== this.previousScene || active !== this.previousActive) {
      this.previousScene?.setGogglesActive?.(false);
      scene?.setGogglesActive?.(active);
      this.previousScene = scene; this.previousActive = active;
    }
    setCharacterEquipped(active);
    document.getElementById('goggles-overlay')?.classList.toggle('hidden', !active);
    const status = document.getElementById('goggles-status');
    if (status) status.textContent = !this.collected ? '' : active ? 'SCANNER ON · Red: pistol · Yellow: crowbar · N: remove goggles' : 'N: equip scanner goggles';
  }
  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.previousScene?.setGogglesActive?.(false);
    this.context().setCharacterEquipped(false);
    document.getElementById('goggles-overlay')?.classList.add('hidden');
  }
}
