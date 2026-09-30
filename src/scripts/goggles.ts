import type { Player } from './player.js';

interface GogglesContext {
  player: Player | null;
  scene: { setGogglesActive?: (active: boolean) => void } | null;
  setCharacterEquipped: (active: boolean) => void;
  onToggle?: (active: boolean) => void;
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
  collect(equip = true) { this.collected = true; this.equipped = equip; this.update(); }
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyN' || event.repeat || !this.collected || !this.context().player?.isEnabled()
      || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault(); this.equipped = !this.equipped; this.update();
  };
  update() {
    const { player, scene, setCharacterEquipped, onToggle } = this.context();
    const active = this.equipped && !!player?.isEnabled() && player.getHealth() > 0;
    if (scene !== this.previousScene || active !== this.previousActive) {
      this.previousScene?.setGogglesActive?.(false);
      scene?.setGogglesActive?.(active);
      this.previousScene = scene; this.previousActive = active;
      onToggle?.(active);
    }
    setCharacterEquipped(active);
    document.getElementById('goggles-overlay')?.classList.toggle('hidden', !active);
  }
  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.previousScene?.setGogglesActive?.(false);
    this.context().setCharacterEquipped(false);
    this.context().onToggle?.(false);
    this.previousScene = null; this.previousActive = false;
    document.getElementById('goggles-overlay')?.classList.add('hidden');
  }
}
