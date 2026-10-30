import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, at } from '../src/paths.mjs';
import { validateInput } from '../src/core.mjs';

const short = JSON.parse(await fs.readFile(at('examples', 'short.json'), 'utf8'));
const quote = JSON.parse(await fs.readFile(at('examples', 'quote-three-media.json'), 'utf8'));
const checks = [];
const outputDir = at('test-results', 'regressions');
await fs.mkdir(outputDir, { recursive: true });
after(async () => {
  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ checks }, null, 2) + '\n');
});

async function cli(input, { mode = 'preview', missingBrowser = false } = {}) {
  const folder = await fs.mkdtemp(path.join(outputDir, 'cli-'));
  const file = path.join(folder, 'input.json');
  const makeAbsolute = data => {
    const copy = structuredClone(data);
    function visit(p) {
      p.author.avatar = path.resolve(at('examples'), p.author.avatar);
      p.sourceScreenshot.file = path.resolve(at('examples'), p.sourceScreenshot.file);
      p.media.forEach(m => { m.file = path.resolve(at('examples'), m.file); });
      if (p.quote) visit(p.quote);
    }
    visit(copy.post);
    return copy;
  };
  await fs.writeFile(file, JSON.stringify(Array.isArray(input) ? input.map(makeAbsolute) : makeAbsolute(input)));
  const env = { ...process.env };
  if (missingBrowser) env.PLAYWRIGHT_BROWSERS_PATH = path.join(folder, 'not-installed');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [at('src', 'cli.mjs'), '--input', file, '--out', path.join(folder, 'out'), '--mode', mode], { cwd: ROOT, env, windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr }));
  });
  const batch = JSON.parse(await fs.readFile(path.join(folder, 'out', 'batch-report.json'), 'utf8'));
  return { ...result, folder, batch };
}

test('转推/回复缺少作者字段时返回校验问题，不抛字符串调用异常', () => {
  for (const type of ['repost', 'reply']) for (const key of ['authorHandle', 'authorName', 'url']) {
    const data = structuredClone(quote);
    const p = data.post.quote;
    data.post.relationship = { type, authorName: p.author.name, authorHandle: p.author.handle, url: p.url };
    delete data.post.relationship[key];
    let result;
    assert.doesNotThrow(() => { result = validateInput(data); });
    assert.ok(result.issues.some(i => i.code === 'RELATIONSHIP_UNKNOWN'), `${type}: ${key}`);
  }
  checks.push({ name: '缺少转推/回复作者信息', passed: true });
});

test('缺少指定 Chromium：预览退出码为 1、无 PNG，批量仍记录所有条目', async () => {
  const result = await cli([short, short], { missingBrowser: true });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.batch.count, 2);
  for (const row of result.batch.results) {
    assert.equal(row.png, null);
    assert.ok(row.issues.some(i => i.code === 'BROWSER_NOT_INSTALLED'));
    assert.equal((await fs.readdir(row.dir)).some(f => f.endsWith('.preview.png')), false);
  }
  checks.push({ name: '浏览器缺失不报成功', passed: true, exitCode: result.code, count: result.batch.count });
});

test('输入校验导致预览未生成 PNG：退出码为 2', async () => {
  const invalid = structuredClone(short);
  invalid.post.id = 'invalid-id';
  const result = await cli(invalid);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.equal(result.batch.results[0].png, null);
  assert.ok(result.batch.results[0].issues.some(i => i.code === 'SCHEMA'));
  checks.push({ name: '无 PNG 的校验失败不报成功', passed: true, exitCode: result.code });
});

test('带警告且确实生成 PNG 的预览仍返回 0', async () => {
  const result = await cli(short);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(result.batch.results[0].png);
  assert.equal(result.batch.results[0].status, 'blocked');
  checks.push({ name: '成功的警告预览', passed: true, exitCode: result.code });
});

test('测试数据导出成品被阻止：退出码为 2 且无成品 PNG', async () => {
  const result = await cli(short, { mode: 'publish' });
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.equal(result.batch.results[0].png, null);
  checks.push({ name: '成品校验失败的退出码', passed: true, exitCode: result.code });
});

async function localScript(script, env = process.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [at('scripts', script)], { cwd: ROOT, env, windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

test('本机预检实际输出 PNG 并声明不依赖云环境', async () => {
  const result = await localScript('check-local.mjs');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const info = JSON.parse(result.stdout.trim());
  assert.equal(info.mode, 'local'); assert.equal(info.requiresCloud, false);
  assert.equal(info.chromium, '156.0.8078.4'); assert.equal(info.width, 2560);
  assert.equal(path.isAbsolute(info.png), true);
  assert.ok((await fs.stat(info.png)).size > 0);
  checks.push({ name: '本机 PNG 预检', passed: true });
});

test('本地启动在浏览器缺失时中止，不发布可用网页地址', async () => {
  const folder = await fs.mkdtemp(path.join(outputDir, 'startup-'));
  const result = await localScript('start-local.mjs', { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(folder, 'not-installed') });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /BROWSER_NOT_INSTALLED/);
  assert.doesNotMatch(result.stdout, /Local: http/);
  checks.push({ name: '未就绪时本地启动中止', passed: true, exitCode: result.code });
});
