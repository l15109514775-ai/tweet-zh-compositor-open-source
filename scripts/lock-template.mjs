import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { at } from '../src/paths.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const stable = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const config = JSON.parse(await fs.readFile(at('template.json'), 'utf8'));
let previous;
try { previous = JSON.parse(await fs.readFile(at('template-lock.json'), 'utf8')); } catch {}
const lock = { version: config.version, configSha256: sha(stable(config)), sourceSha256: sha(await fs.readFile(at('src', 'template.mjs'))), referenceSha256: sha(await fs.readFile(at('reference', 'mvp.jpg'))) };
if (previous && previous.version === lock.version && (previous.configSha256 !== lock.configSha256 || previous.sourceSha256 !== lock.sourceSha256)) throw new Error('模板已变更；先修改 template.json 的 version，再重建锁。');
await fs.writeFile(at('template-lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify(lock));
