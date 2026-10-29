import {
  fetchAsset,
  getAssetCacheStatus,
  runPreloadTasks,
  type PreloadProgress,
  type PreloadTask,
} from "./assetCache.js";
import { MODEL_ASSET_URLS, modelPreloadTasks } from "./loader.js";
import { LOADING_IMAGE_URLS } from "./chapters.js";
import { MUSIC_URLS } from "../helpers/audio/gameMusic.js";
import { preloadMusic } from "../helpers/audio/bufferedMusic.js";
import { RECORDED_SOUND_URLS } from "../helpers/audio/recordedSounds.js";
import { SFX_URLS } from "../helpers/audio/sfx.js";
import { preloadSample } from "../helpers/audio/spatialAudio.js";
import {
  CORRIDOR_FOOTAGE,
  preloadMonitorFootage,
} from "../scripts/global/corridorMonitor.js";
import { CAMERA_FOOTAGE } from "../scripts/global/surveillanceFootage.js";
import { preloadEarthTextures } from "../scripts/global/earthTexture.js";
import earthTextureUrl from "../assets/planets/earth-maps.rgba.bin?url";
import { preloadComicEffectArtwork } from "../scripts/global/comicEffects.js";
import { preloadEscapeShipGeometry } from "../scripts/items/createEscapeShip.js";
import {
  preloadJungleTextures,
  preloadPhotoBark,
  PHOTO_BARK_URLS,
} from "../scripts/level-3/jungleTextures.js";
import shieldPowerupUrl from "../assets/power ups/Shield_powerup.png?url";
import {
  COMBAT_ANIMATION_URLS,
  preloadCombatAnimations,
} from "./combatAnimations.js";

export const GAME_ASSET_URLS = [
  ...new Set([
    ...MODEL_ASSET_URLS,
    ...LOADING_IMAGE_URLS,
    ...Object.values(MUSIC_URLS),
    ...RECORDED_SOUND_URLS,
    ...Object.values(SFX_URLS),
    ...CORRIDOR_FOOTAGE,
    ...Object.values(CAMERA_FOOTAGE),
    ...COMBAT_ANIMATION_URLS,
    ...PHOTO_BARK_URLS,
    shieldPowerupUrl,
    earthTextureUrl,
  ]),
];

export async function preloadGameAssets(
  moduleTasks: readonly PreloadTask[],
  setupTasks: readonly PreloadTask[],
  report: (progress: PreloadProgress, note: string) => void,
) {
  const downloads = GAME_ASSET_URLS.map((source) => ({
    label: "Caching game assets",
    run: async () => {
      await fetchAsset(source);
    },
  }));
  const musicTasks: PreloadTask[] = [...Object.entries(MUSIC_URLS)]
    .reverse()
    .map(([, source]) => ({
      label: "Preparing the soundtrack",
      run: () => preloadMusic(source),
    }));
  const preparations: PreloadTask[] = [
    ...moduleTasks,
    ...modelPreloadTasks(),
    {
      label: "Preparing authored sword and melee animations",
      run: preloadCombatAnimations,
    },
    {
      label: "Preparing prerecorded surveillance footage",
      run: () =>
        preloadMonitorFootage([
          ...CORRIDOR_FOOTAGE,
          ...Object.values(CAMERA_FOOTAGE),
        ]),
    },
    {
      label: "Preparing reusable planet textures",
      run: () => preloadEarthTextures(earthTextureUrl),
    },
    { label: "Preparing combat feedback", run: preloadComicEffectArtwork },
    {
      label: "Preparing reusable shuttle geometry",
      run: async () => preloadEscapeShipGeometry(),
    },
    {
      label: "Preparing jungle surface textures",
      run: async () => preloadJungleTextures(),
    },
    { label: "Preparing photographed tree bark", run: preloadPhotoBark },
    ...musicTasks,
    ...setupTasks,
    {
      label: "Preparing spatial sound effects",
      run: async () => {
        if (typeof window.AudioContext !== "function") return;
        for (const url of new Set([
          ...RECORDED_SOUND_URLS,
          ...Object.values(SFX_URLS),
        ]))
          await preloadSample(url);
      },
    },
  ];
  const total = downloads.length + preparations.length;
  const notify = (offset: number) => (progress: PreloadProgress) => {
    const cache = getAssetCacheStatus();
    const note =
      cache.warning ??
      `${cache.files} files cached / ${(cache.bytes / 1048576).toFixed(1)} MB / ${
        cache.persistent
          ? "Reusable on the next visit"
          : "Ready for this play session"
      }`;
    report(
      { ...progress, completed: offset + progress.completed, total },
      note,
    );
  };
  await runPreloadTasks(downloads, notify(0), 4);
  await runPreloadTasks(preparations, notify(downloads.length));
}
