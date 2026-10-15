import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

if (!ffmpeg) throw new Error('FFmpeg is not available on this platform');
const directory = fileURLToPath(new URL('../src/assets/bgm/', import.meta.url));
for (const name of (await readdir(directory)).filter(name => name.endsWith('.m4a'))) {
  const output = path.join(directory, name.replace(/\.m4a$/, '.ogg'));
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-i', path.join(directory, name), '-vn', '-c:a', 'libvorbis', '-q:a', '5', output], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Audio conversion failed: ${name}`);
  console.log(`Prepared ${path.basename(output)}`);
}
