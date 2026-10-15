interface CachedAsset { blob: Blob; objectUrl?: string; }
export interface PreloadTask { label: string; run(): Promise<unknown>; }
export interface PreloadProgress { completed: number; total: number; label: string; }

const assets = new Map<string, CachedAsset>();
const pending = new Map<string, Promise<CachedAsset>>();
let diskCache: Promise<Cache | null> | undefined;
let cacheName = 'brondons-revenge-assets';
let storageWarning: string | null = null;

function absoluteUrl(source: string) {
  return typeof document === 'undefined' ? source : new URL(source, document.baseURI).href;
}

export function configureAssetCache(sources: readonly string[]) {
  if (diskCache) throw new Error('The asset manifest must be configured before loading assets');
  let hash = 2166136261;
  for (const character of [...new Set(sources.map(absoluteUrl))].sort().join('\n')) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  cacheName += `-${(hash >>> 0).toString(16)}`;
}

function storageUnavailable(error: unknown) {
  if (!(error instanceof Error) || !['QuotaExceededError', 'SecurityError', 'NotSupportedError', 'InvalidStateError'].includes(error.name))
    throw error;
  storageWarning = 'Browser storage is unavailable. Assets are cached for this tab only.';
  console.warn('[Asset cache]', storageWarning, error);
}

function persistentCache() {
  if (!diskCache) {
    if (typeof caches === 'undefined' || import.meta.env.DEV) {
      diskCache = Promise.resolve(null);
    } else {
      diskCache = caches.open(cacheName).catch(error => { storageUnavailable(error); return null; });
    }
  }
  return diskCache;
}

async function asset(source: string): Promise<CachedAsset> {
  const key = absoluteUrl(source), cached = assets.get(key);
  if (cached) return cached;
  let loading = pending.get(key);
  if (!loading) {
    loading = (async () => {
      const cache = await persistentCache();
      let response: Response | undefined;
      if (cache) {
        try { response = await cache.match(key); }
        catch (error) { storageUnavailable(error); }
      }
      if (!response) {
        response = await fetch(source);
        if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${source}`);
        const blob = new Blob([await response.arrayBuffer()], {
          type: response.headers?.get('content-type') ?? 'application/octet-stream',
        });
        if (!blob.size) throw new Error(`Asset is empty: ${source}`);
        const record = { blob };
        if (cache) {
          try { await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } })); }
          catch (error) { storageUnavailable(error); }
        }
        assets.set(key, record);
        return record;
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error(`Cached asset is empty: ${source}`);
      const record = { blob }; assets.set(key, record);
      return record;
    })().finally(() => { pending.delete(key); });
    pending.set(key, loading);
  }
  return loading;
}

export async function fetchAsset(source: string): Promise<Response> {
  const { blob } = await asset(source);
  return new Response(blob, { headers: { 'Content-Type': blob.type } });
}

function objectUrl(record: CachedAsset) {
  return record.objectUrl ??= URL.createObjectURL(record.blob);
}

export async function assetUrl(source: string) { return objectUrl(await asset(source)); }

/** Synchronous loaders still work normally before the full-game cache is prepared. */
export function cachedAssetUrl(source: string) {
  const record = assets.get(absoluteUrl(source));
  return record ? objectUrl(record) : source;
}

export function getAssetCacheStatus() {
  return { files: assets.size, bytes: [...assets.values()].reduce((sum, record) => sum + record.blob.size, 0),
    warning: storageWarning, persistent: !import.meta.env.DEV && typeof caches !== 'undefined' && !storageWarning };
}

export async function runPreloadTasks(tasks: readonly PreloadTask[],
  report: (progress: PreloadProgress) => void, concurrency = 1) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Preload concurrency must be a positive integer');
  let cursor = 0, completed = 0, failed = false;
  const worker = async () => {
    while (!failed && cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        await task.run();
        report({ completed: ++completed, total: tasks.length, label: task.label });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      } catch (error) { failed = true; throw error; }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
