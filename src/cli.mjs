import fs from 'node:fs/promises';
import path from 'node:path';
import { at } from './paths.mjs';
import { Renderer } from './renderer.mjs';
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (args.includes('--help') || !value('--input')) {
  console.log('Usage: npm run render -- --input <post.json|batch.json> [--out <absolute-directory>] [--mode preview|publish] [--template <json>]');
  console.log('Batch: JSON array of input objects. Relative image paths resolve against the input JSON directory. Publish errors exit 2 and produce reports without a publish PNG.');
  process.exit(args.includes('--help') ? 0 : 1);
}
const inputFile = path.resolve(value('--input'));
const parsed = JSON.parse((await fs.readFile(inputFile, 'utf8')).replace(/^\uFEFF/, ''));
const inputs = Array.isArray(parsed) ? parsed : [parsed];
if (!inputs.length || inputs.length > 100) throw new Error('每批需要 1 至 100 条输入。');
const outputDir = path.resolve(value('--out') || at('outputs'));
const mode = value('--mode') || 'preview';
const renderer = new Renderer();
const results = [];
try {
  for (const input of inputs) {
    const result = await renderer.render(input, { baseDir: path.dirname(inputFile), outputDir, mode, templateFile: value('--template') });
    console.log(JSON.stringify({ dir: result.dir, status: result.report.status, png: result.report.png?.file || null, sourceUrl: result.report.sourceUrl }));
    results.push({ dir: result.dir, status: result.report.status, png: result.report.png, sourceUrl: result.report.sourceUrl, issues: result.report.issues });
  }
} finally { await renderer.close(); }
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'batch-report.json'), JSON.stringify({ mode, count: results.length, results }, null, 2) + '\n');
// A warning preview is successful only when its PNG was actually written.
const runtimeFailure = results.some(r => r.issues.some(i => ['RENDER_FAILED', 'BROWSER_NOT_INSTALLED'].includes(i.code)));
if (runtimeFailure) process.exitCode = 1;
else if (results.some(r => mode === 'publish' ? r.status !== 'ready' || !r.png : !r.png)) process.exitCode = 2;
