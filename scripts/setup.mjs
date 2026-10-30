import { at, ROOT } from '../src/paths.mjs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const hash = b => createHash('sha256').update(b).digest('hex');
const files = [
  ['NotoSansCJKsc-Regular.otf', 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf'],
  ['NotoSansCJKsc-Bold.otf', 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf'],
  ['NotoColorEmoji.ttf', 'https://raw.githubusercontent.com/googlefonts/noto-emoji/v2.051/fonts/NotoColorEmoji.ttf'],
  ['OFL-CJK.txt', 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE'],
  ['OFL-Emoji.txt', 'https://raw.githubusercontent.com/googlefonts/noto-emoji/v2.051/fonts/LICENSE']
];
await fs.mkdir(at('assets', 'fonts'), { recursive: true });
let old = {};
try { old = JSON.parse(await fs.readFile(at('assets', 'fonts', 'manifest.json'), 'utf8')); } catch {}
const manifest = {};
for (const [name, url] of files) {
  const target = at('assets', 'fonts', name);
  let bytes;
  try { bytes = await fs.readFile(target); } catch {}
  if (!bytes || (old[name] && hash(bytes) !== old[name].sha256)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`Download ${name}: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    if (old[name] && hash(bytes) !== old[name].sha256) throw new Error(`Font hash mismatch: ${name}`);
    await fs.writeFile(target, bytes);
  }
  manifest[name] = { url, sha256: hash(bytes), bytes: bytes.length };
  console.log(`${name}: ${bytes.length} bytes, SHA-256 verified`);
}
await fs.writeFile(at('assets', 'fonts', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (!process.argv.includes('--fonts-only')) {
  await fs.mkdir(at('runtime', 'tmp'), { recursive: true });
  const installEnv = { ...process.env, TEMP: at('runtime', 'tmp'), TMP: at('runtime', 'tmp'), TMPDIR: at('runtime', 'tmp') };
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [at('node_modules', 'playwright', 'cli.js'), 'install', 'chromium', '--only-shell'], {
      cwd: ROOT, env: installEnv, stdio: 'inherit', windowsHide: true
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Browser install exit ${code}`)));
  });
}
console.log('Local runtime ready. npm start');
