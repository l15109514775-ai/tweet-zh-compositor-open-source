import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('此包仅适用于 Debian 13 amd64/x86_64。');
const osRelease = await fs.readFile('/etc/os-release', 'utf8');
if (!/^ID=debian$/m.test(osRelease) || !/^VERSION_ID="?13"?$/m.test(osRelease)) throw new Error('请在目标 Debian 13 系统上自检。');
const libc = process.report.getReport().header.glibcVersionRuntime || '';
if (libc !== '2.41') throw new Error(`目标基线为 glibc 2.41，当前为 ${libc || '未知'}。`);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'OFFLINE-MANIFEST.json'), 'utf8'));
for (const file of manifest.files) {
  const full = path.resolve(root, file.file);
  if (path.relative(root, full).startsWith('..')) throw new Error('清单路径越界。');
  const bytes = await fs.readFile(full);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`文件哈希不符：${file.file}`);
}
for (const [name, target] of Object.entries(manifest.links)) {
  if (await fs.readlink(path.join(root, name)) !== target) throw new Error(`符号链接不符：${name}`);
}
console.log(JSON.stringify({ ok: true, offlineIntegrity: true, files: manifest.files.length, platform: process.platform, arch: process.arch, glibc: libc }));
