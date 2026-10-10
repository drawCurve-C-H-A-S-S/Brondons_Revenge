import { fetchAsset, getAssetCacheStatus, runPreloadTasks, type PreloadProgress, type PreloadTask } from './assetCache.js';
import { MODEL_ASSET_URLS, modelPreloadTasks } from './loader.js';
import { LOADING_IMAGE_URLS } from './chapters.js';
import { MUSIC_URLS } from '../helpers/audio/gameMusic.js';
import { preloadMusic } from '../helpers/audio/bufferedMusic.js';
import { CORRIDOR_FOOTAGE, preloadCorridorFootage } from '../helpers/scene/corridorMonitor.js';
import { preloadEarthTextures } from '../scripts/earthTexture.js';
import shieldPowerupUrl from '../assets/power ups/Shield_powerup.png?url';

export const GAME_ASSET_URLS = [...new Set([
  ...MODEL_ASSET_URLS, ...LOADING_IMAGE_URLS, ...Object.values(MUSIC_URLS), ...CORRIDOR_FOOTAGE, shieldPowerupUrl,
])];

export async function preloadGameAssets(moduleTasks: readonly PreloadTask[], setupTasks: readonly PreloadTask[],
  report: (progress: PreloadProgress, note: string) => void) {
  const downloads = GAME_ASSET_URLS.map(source => ({
    label: 'Caching game assets', run: async () => { await fetchAsset(source); },
  }));
  const musicTasks: PreloadTask[] = [...Object.entries(MUSIC_URLS)].reverse()
    .map(([, source]) => ({ label: 'Preparing the soundtrack', run: () => preloadMusic(source) }));
  const preparations: PreloadTask[] = [
    ...moduleTasks, ...modelPreloadTasks(),
    { label: 'Preparing animated surveillance footage', run: preloadCorridorFootage },
    { label: 'Generating reusable planet textures', run: preloadEarthTextures },
    ...musicTasks, ...setupTasks,
  ];
  const total = downloads.length + preparations.length;
  const notify = (offset: number) => (progress: PreloadProgress) => {
    const cache = getAssetCacheStatus();
    const note = cache.warning ?? `${cache.files} files cached / ${(cache.bytes / 1048576).toFixed(1)} MB / ${
      cache.persistent ? 'Reusable on the next visit' : 'Ready for this play session'}`;
    report({ ...progress, completed: offset + progress.completed, total }, note);
  };
  await runPreloadTasks(downloads, notify(0), 4);
  await runPreloadTasks(preparations, notify(downloads.length));
}
