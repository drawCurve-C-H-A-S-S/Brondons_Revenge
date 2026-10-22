import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, runPreloadTasks;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ runPreloadTasks } = await server.ssrLoadModule('/core/assetCache.ts'));
});
after(async () => server?.close());

test('loading reports the active task before running it and only counts finished tasks', async () => {
  const reports = [];
  await runPreloadTasks([
    { label: 'Preparing footage', async run() {
      assert.deepEqual(reports.at(-1), { completed: 0, total: 2, label: 'Preparing footage' });
    } },
    { label: 'Preparing planet maps', async run() {
      assert.deepEqual(reports.at(-1), { completed: 1, total: 2, label: 'Preparing planet maps' });
    } },
  ], progress => reports.push(progress));
  assert.deepEqual(reports, [
    { completed: 0, total: 2, label: 'Preparing footage' },
    { completed: 1, total: 2, label: 'Preparing footage' },
    { completed: 1, total: 2, label: 'Preparing planet maps' },
    { completed: 2, total: 2, label: 'Preparing planet maps' },
  ]);
});

test('parallel preparations retain accurate completion counts', async () => {
  const reports = [], finish = [];
  const pending = runPreloadTasks(['first', 'second'].map(label => ({
    label, run: () => new Promise(resolve => finish.push(resolve)),
  })), progress => reports.push(progress), 2);
  assert.deepEqual(reports.map(progress => progress.completed), [0, 0]);
  finish[1](); finish[0]();
  await pending;
  assert.deepEqual(reports.map(progress => progress.completed), [0, 0, 1, 2]);
  assert.ok(reports.every(progress => progress.total === 2));
});

test('failed preparations never count as completed or start later tasks', async () => {
  const failure = new Error('Footage preparation failed'), reports = [];
  await assert.rejects(runPreloadTasks([
    { label: 'Preparing footage', async run() { throw failure; } },
    { label: 'Preparing planet maps', async run() { assert.fail('Later tasks must not start after a failure'); } },
  ], progress => reports.push(progress)), failure);
  assert.deepEqual(reports, [{ completed: 0, total: 2, label: 'Preparing footage' }]);
});
