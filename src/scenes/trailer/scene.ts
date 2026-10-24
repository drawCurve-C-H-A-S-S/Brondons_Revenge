import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { createPlayer } from "../../scripts/player/player.js";
import { CHAIR_TRAILER_DURATION, createChairHorizon } from "./chairHorizon.js";

export function createScene({ onFinished }: { onFinished: () => void }) {
  const visual = createChairHorizon(),
    physics = createScenePhysics();
  const player = createPlayer({
    camera: visual.camera,
    physicsWorld: physics.world,
    spawnPosition: { x: 0, y: 0, z: 0 },
  });
  player.disable();
  player.clearInput();
  let elapsed = 0,
    paused = false,
    disposed = false,
    finished = false;
  function updatePhysics(dt: number) {
    if (disposed || paused || document.hidden) return;
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Trailer time must be finite and nonnegative");
    elapsed = Math.min(CHAIR_TRAILER_DURATION, elapsed + Math.min(dt, 0.1));
    const progress = elapsed / CHAIR_TRAILER_DURATION;
    const ease = progress * progress * (3 - 2 * progress);
    visual.update(
      elapsed,
      5 - ease * 4.05,
      window.innerWidth / window.innerHeight,
    );
    if (elapsed + 1e-8 >= CHAIR_TRAILER_DURATION && !finished) {
      elapsed = CHAIR_TRAILER_DURATION;
      finished = true;
      onFinished();
    }
  }
  return {
    scene: visual.scene,
    camera: visual.camera,
    player,
    ready: visual.ready,
    updatePhysics,
    ownsWeaponInput: true,
    isCinematic: () => true,
    hideCharacter: () => true,
    hideMinimap: () => true,
    getSceneId: () => "trailer",
    getDeveloperSceneId: () => "scene100",
    getMusicTrack: (): "loading" => "loading",
    isMusicPaused: () => paused || document.hidden,
    setMenuPaused(value: boolean) {
      paused = value;
      player.clearInput();
    },
    clearInput: () => player.clearInput(),
    dispose() {
      if (disposed) return;
      disposed = true;
      player.dispose();
      physics.dispose();
      visual.dispose();
    },
  };
}
