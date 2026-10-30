import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
const cache = path.resolve(process.argv[2] || './runtime/offline-downloads');
await fs.mkdir(cache, { recursive: true });
async function get(url, name) {
  const file = path.join(cache, name);
  try { if ((await fs.stat(file)).size > 0) return file; } catch {}
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const tmp = file + '.partial';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await fs.rename(tmp, file);
  console.log(JSON.stringify({ file, bytes: (await fs.stat(file)).size, url }));
  return file;
}
let nodeVersion = '24.22.1';
const nodeHead = await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
if (!nodeHead.ok) throw new Error('Pinned Node 24.22.1 download unavailable');
await Promise.all([
  get(`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz`, 'node-linux-x64.tar.xz'),
  get(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, 'node-SHASUMS256.txt'),
  get('https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-headless-shell-linux64.zip', 'chromium-headless-shell-linux64.zip'),
  get('https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1013/ffmpeg-linux.zip', 'ffmpeg-linux.zip'),
  get('https://deb.debian.org/debian/dists/trixie/main/binary-amd64/Packages.xz', 'trixie-Packages.xz'),
  get('https://deb.debian.org/debian-security/dists/trixie-security/main/binary-amd64/Packages.xz', 'trixie-security-Packages.xz')
]);
const sums = await fs.readFile(path.join(cache, 'node-SHASUMS256.txt'), 'utf8');
const name = `node-v${nodeVersion}-linux-x64.tar.xz`;
const expected = sums.split('\n').find(l => l.trim().endsWith(' ' + name))?.split(/\s+/)[0];
const actual = createHash('sha256').update(await fs.readFile(path.join(cache, 'node-linux-x64.tar.xz'))).digest('hex');
if (!expected || actual !== expected) throw new Error('Node publisher SHA-256 mismatch');
await fs.writeFile(path.join(cache, 'versions.json'), JSON.stringify({ nodeVersion, nodeArchiveSha256: actual, chromiumVersion: '156.0.8078.4', chromiumRevision: '1248', ffmpegRevision: '1013' }, null, 2) + '\n');
console.log(JSON.stringify({ nodeVersion, nodeVerified: true }));
