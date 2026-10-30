import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Renderer } from '../src/renderer.mjs';
import { validateInput, formatTime, sha256, loadTemplate, checkGlyphs, loadFonts } from '../src/core.mjs';
import { createFixtures } from '../scripts/fixtures.mjs';
import { at } from '../src/paths.mjs';
const renderer = new Renderer();
let cases, reference;
const results = {};
const records = [];
before(async () => { ({ cases, reference } = await createFixtures()); });
after(async () => {
  await renderer.close();
  await fs.mkdir(at('test-results'), { recursive: true });
  await fs.writeFile(at('test-results', 'acceptance-summary.json'), JSON.stringify({ testDataOnly: true, cases: records }, null, 2) + '\n');
});
async function render(data, mode = 'preview', folder = 'acceptance') {
  return await renderer.render(data, { baseDir: at('examples'), outputDir: at('test-results', folder), mode });
}
for (const name of ['short', 'long', 'mixed', 'three-media', 'quote-three-media', 'missing-metrics']) {
  test(`验收样例：${name}`, async () => {
    const result = await render(cases[name]);
    const r = result.report;
    assert.ok(r.png, JSON.stringify(r.issues));
    assert.deepEqual(r.issues.filter(i => i.severity === 'error').map(i => i.code), ['TEST_FIXTURE']);
    assert.equal(r.checks.translationExact, true);
    assert.equal(r.checks.quoteComplete, true);
    assert.equal(r.checks.imagesUnchanged, true);
    assert.equal(r.checks.mediaAspectRatios, true);
    assert.equal(r.checks.glyphCoverage, true);
    assert.deepEqual(r.checks.overflow, []);
    for (const text of r.layout.translations) {
      assert.equal(text.fontSize, '40px'); assert.equal(text.lineHeight, '56px');
    }
    for (const a of r.assets) assert.equal(sha256(await fs.readFile(path.join(result.dir, a.outputFile))), a.sha256);
    const pngMeta = await sharp(path.join(result.dir, r.png.file)).metadata();
    assert.equal(pngMeta.width, 2560); assert.equal(pngMeta.height, r.png.height);
    if (name === 'long') assert.ok(r.layout.card.height > results.short.report.layout.card.height * 5);
    if (name === 'three-media') assert.equal(r.layout.images.filter(i => i.role === 'media-image').length, 3);
    if (name === 'quote-three-media') { assert.equal(r.layout.quotes.length, 1); assert.equal(r.layout.images.filter(i => i.role === 'media-image').length, 3); }
    if (name === 'missing-metrics') assert.equal(r.issues.filter(i => i.code === 'METRIC_UNKNOWN').length, 5);
    results[name] = result;
    records.push({ name, png: path.join(result.dir, r.png.file), report: path.join(result.dir, result.reportName), passed: true, checks: r.checks });
  });
}
test('同输入、字体、模板与浏览器重复渲染 PNG 字节一致', async () => {
  const again = await render(cases.short);
  assert.equal(again.report.png.sha256, results.short.report.png.sha256);
});
test('1、2、4 张配图均保留比例和完整文件', async () => {
  for (const n of [1, 2, 4]) {
    const data = structuredClone(cases['three-media']);
    data.post.media = Array.from({ length: n }, (_, i) => ({ file: `assets/test-media-${i + 1}.png`, completeness: 'complete', reviewed: true }));
    data.post.sourceMediaCount = n;
    const r = (await render(data, 'preview', 'edge-cases')).report;
    assert.ok(r.png, JSON.stringify(r.issues));
    assert.equal(r.checks.mediaAspectRatios, true); assert.equal(r.checks.imagesUnchanged, true);
    assert.equal(r.layout.images.filter(i => i.role === 'media-image').length, n);
  }
});
test('缺少真实核对依据/引用遗漏/错误时间会阻止成品', async () => {
  const data = structuredClone(cases['quote-three-media']);
  data.post.quote = null;
  data.post.sourceScreenshot.file = null;
  data.post.publishedAt = '2026-02-30T25:61:00+09:00';
  const result = await render(data, 'publish', 'edge-cases');
  assert.equal(result.report.png, null); assert.equal(result.report.publishable, false);
  for (const code of ['SOURCE_QUOTE_MISSING', 'SCREENSHOT_MISSING', 'TIME_FORMAT']) assert.ok(result.report.issues.some(i => i.code === code));
  assert.equal((await fs.readdir(result.dir)).some(n => n.endsWith('.publish.png')), false);
});
test('成品通路（仅内部测试，不对外宣称真实来源）与可移植输入', async () => {
  const data = structuredClone(cases.short);
  delete data.testFixture;
  // Synthetic pixels exercise the successful branch; these files stay in the internal test folder.
  data.post.author.name = '内部测试 · 非真实推文';
  const result = await render(data, 'publish', 'internal-only');
  assert.equal(result.report.status, 'ready', JSON.stringify(result.report.issues));
  assert.ok(result.report.png);
  const portable = JSON.parse(await fs.readFile(path.join(result.dir, `${result.basename}.input.json`), 'utf8'));
  const again = await renderer.render(portable, { baseDir: result.dir, outputDir: at('test-results', 'internal-only'), mode: 'publish' });
  assert.equal(again.report.png.sha256, result.report.png.sha256);
});
test('未确认认证不显示；裁切版本明确提醒', async () => {
  const data = structuredClone(cases['three-media']);
  data.post.author.verified = true; data.post.author.verificationEvidence = null;
  data.post.media[0].completeness = 'cropped';
  const r = (await render(data, 'preview', 'edge-cases')).report;
  assert.ok(r.issues.some(i => i.code === 'VERIFICATION_UNCONFIRMED'));
  assert.ok(r.issues.some(i => i.code === 'MEDIA_CROPPED'));
  assert.equal(r.checks.imagesUnchanged, true);
});
test('回复与转推明确保留原作者及原帖', async () => {
  for (const type of ['reply', 'repost']) {
    const data = structuredClone(cases['quote-three-media']);
    const p = data.post.quote;
    data.post.relationship = { type, authorName: p.author.name, authorHandle: p.author.handle, url: p.url };
    const r = (await render(data, 'preview', 'edge-cases')).report;
    assert.ok(r.png); assert.equal(r.checks.quoteComplete, true);
    assert.ok(r.layout.blocks.some(b => b.field === 'post.relationship'));
    assert.deepEqual(r.issues.filter(i => i.severity === 'error').map(i => i.code), ['TEST_FIXTURE']);
  }
});
test('缺字、配图数量遗漏、时区错误、未知字段可检出', async () => {
  const issues = [];
  checkGlyphs(['缺字测试\u{10ffff}'], await loadFonts(), issues);
  assert.ok(issues.some(i => i.code === 'GLYPH_MISSING'));
  const data = structuredClone(cases.short);
  data.post.sourceMediaCount = 2; data.post.sourceTimezone = 'Asia/Shanghai';
  const codes = validateInput(data).issues.map(i => i.code);
  assert.ok(codes.includes('MEDIA_COUNT_MISMATCH')); assert.ok(codes.includes('TIMEZONE_MISMATCH'));
  data.unexpected = 'OCR 未核对结果'; assert.equal(validateInput(data).schemaValid, false);
});
test('日本/北京时间跨日转换；正文相对时间未改写', () => {
  assert.equal(formatTime('2026-10-30T00:05:00+09:00', 'Asia/Shanghai'), '23:05（北京时间）· 2026年10月29日');
  assert.equal(formatTime('2026-10-29T23:30:00+08:00', 'Asia/Tokyo'), '00:30（日本时间）· 2026年10月30日');
  assert.equal(results.long.report.layout.translations[0].text, cases.long.post.translation);
});
test('公开示例几何回归：卡片布局与文本（不含原始参考素材）', async () => {
  const result = await render(reference, 'preview', 'reference-layout');
  assert.ok(result.report.png, JSON.stringify(result.report.issues));
  assert.equal(result.report.checks.translationExact, true);
  const template = await loadTemplate();
  const layout = result.report.layout;
  assert.equal(layout.card.width, 1280);
  assert.ok(Math.abs(layout.card.height - 537) < 1);
  assert.equal(layout.translations[0].x, template.paddingX);
  const source = await sharp(at('reference', 'mvp.jpg')).resize(1280, 537).png().toBuffer();
  const rendered = await sharp(path.join(result.dir, result.report.png.file)).extract({ left: 0, top: Math.round(layout.card.y * 2), width: 2560, height: 1074 }).resize(1280, 537).png().toBuffer();
  // The complete comparison has a separate, visible TEST banner; the card crop is never delivered as a product.
  const banner = Buffer.from('<svg width="2560" height="70"><rect width="2560" height="70" fill="#fff1cc"/><text x="30" y="46" font-family="sans-serif" font-size="30" fill="#833a00">LAYOUT TEST ONLY / LEFT: REFERENCE / RIGHT: DETERMINISTIC RENDER / NOT FOR PUBLICATION</text></svg>');
  await sharp({ create: { width: 2560, height: 607, channels: 3, background: '#ffffff' } }).composite([{ input: banner, left: 0, top: 0 }, { input: source, left: 0, top: 70 }, { input: rendered, left: 1280, top: 70 }]).png().toFile(at('test-results', 'reference-comparison.png'));
  await fs.writeFile(at('test-results', 'reference-layout.json'), JSON.stringify({ sourcePixels: { width: 1280, height: 537 }, renderedCard: layout.card, body: layout.translations[0], measuredAnchors: { avatar: [38, 28, 102, 102], bodyContainer: [38, 220], timeContainerY: 364, actionsContainerY: 448 }, caveats: ['公开示例使用固定 Noto 字体，不对应真实推文。', '示例头像是自制几何图，仅用于测试。', '作者、时间和数字均为显式测试数据，新帖默认空白。'] }, null, 2) + '\n');
});
