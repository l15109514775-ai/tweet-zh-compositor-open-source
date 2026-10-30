import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { at, ROOT } from '../src/paths.mjs';
import { Renderer } from '../src/renderer.mjs';

export async function checkLocal() {
  const input = JSON.parse(await fs.readFile(at('examples', 'short.json'), 'utf8'));
  input.testFixture = true;
  const renderer = new Renderer();
  try {
    const result = await renderer.render(input, { baseDir: at('examples'), outputDir: at('runtime', 'local-check'), mode: 'preview' });
    const unexpected = result.report.issues.filter(i => i.severity === 'error' && i.code !== 'TEST_FIXTURE');
    if (!result.report.png || unexpected.length) throw new Error(unexpected.map(i => `${i.code}: ${i.message}`).join('\n') || '本机预检没有生成 PNG。');
    return { ok: true, mode: 'local', requiresCloud: false, root: ROOT,
      chromium: result.report.engine.chromium, png: path.join(result.dir, result.report.png.file),
      width: result.report.png.width, height: result.report.png.height,
      checks: result.report.checks, browserCache: process.env.PLAYWRIGHT_BROWSERS_PATH };
  } finally { await renderer.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkLocal())); }
  catch (e) { console.error(`本机出图预检失败：${e.message}`); process.exitCode = 1; }
}
