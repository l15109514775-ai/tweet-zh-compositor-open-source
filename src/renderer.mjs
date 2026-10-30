import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { ROOT, at } from './paths.mjs';
import { validateInput, loadAssets, loadFonts, loadTemplate, checkGlyphs, sha256, stable, safeName, walkPosts, issue } from './core.mjs';
import { buildDocument } from './template.mjs';

export class Renderer {
  browser = null;
  async start() {
    if (!this.browser) {
      const { chromium } = await import('playwright');
      try {
        this.browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
      } catch (cause) {
        if (cause.message.includes("Executable doesn't exist")) {
          const error = new Error(`本机缺少 Playwright 1.64.1 指定的 Chromium。请运行 npm run setup 安装到项目的 runtime/browsers；首次安装需要联网，出图使用本机浏览器。\n${cause.message}`, { cause });
          error.code = 'BROWSER_NOT_INSTALLED';
          throw error;
        }
        throw cause;
      }
    }
    return this;
  }
  async close() { await this.browser?.close(); this.browser = null; }

  async render(input, { baseDir = ROOT, outputDir = at('outputs'), mode = 'preview', templateFile, allowedRoot } = {}) {
    if (!['preview', 'publish'].includes(mode)) throw new Error('mode 仅支持 preview 或 publish');
    const { issues, schemaValid } = validateInput(input);
    const template = await loadTemplate(templateFile);
    const fonts = await loadFonts();
    const assets = schemaValid ? await loadAssets(input, baseDir, issues, allowedRoot) : new Map();
    const inputHash = sha256(stable(input));
    const templateHash = sha256(stable(template));
    const templateLock = JSON.parse(await fs.readFile(at('template-lock.json'), 'utf8'));
    const id = String(input?.post?.id || 'invalid');
    const name = safeName(input?.post?.author?.handle || input?.post?.author?.name || 'unknown').replace(/^@/, '');
    const key = sha256(stable({ input, template, assets: [...assets.values()].map(a => a.sha256), fonts: fonts.map(f => f.sha256), mode, engine: 'playwright-1.64.1' })).slice(0, 16);
    const basename = `${name}_${safeName(id, 30)}`;
    const dir = path.resolve(outputDir, `${basename}_${key}_${mode}`);
    await fs.mkdir(dir, { recursive: true });
    // Delete only the exact previous PNG in this job, so a failed rerun cannot leave an old product.
    await fs.rm(path.join(dir, `${basename}.${mode === 'preview' ? 'preview' : 'publish'}.png`), { force: true });
    await fs.writeFile(path.join(dir, `${basename}.original-input.json`), JSON.stringify(input, null, 2) + '\n');
    const report = {
      reportVersion: 1, mode, status: 'blocked', publishable: false, sourceUrl: input?.post?.url || null,
      inputSha256: inputHash, template: { version: template.version, sha256: templateHash, sourceSha256: templateLock.sourceSha256, referenceSha256: templateLock.referenceSha256, reference: template.reference, locked: template.locked },
      engine: { playwright: '1.64.1', chromium: null, platform: process.platform, arch: process.arch, node: process.version },
      fonts: fonts.map(f => ({ name: f.name, sha256: f.sha256 })), issues,
      checks: { translationExact: false, quoteComplete: false, imagesUnchanged: false, mediaAspectRatios: false, overflow: null, glyphCoverage: false },
      assets: [], layout: null, png: null,
      limitations: ['来源事实和译文语义依赖人工核对；OCR 不作为事实来源。', '固定字体按参考图测量选定；参考图不含字体文件，不能证明是原字体。', '同一模板、字体、浏览器与操作系统下验证排版稳定；跨系统像素级一致性未保证。']
    };
    let page;
    try {
      if (schemaValid) {
        const portable = structuredClone(input);
        await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
        const copied = new Map();
        for (const a of assets.values()) {
          const relative = `assets/${a.sha256}.${a.format === 'jpeg' ? 'jpg' : a.format}`;
          await fs.writeFile(path.join(dir, relative), a.bytes);
          copied.set(a.file, relative);
          report.assets.push({ inputFile: a.file, outputFile: relative, sha256: a.sha256, bytes: a.bytes.length, width: a.width, height: a.height, uses: a.uses, operations: '原文件字节复制；渲染时仅缩放，配图不裁切，头像使用模板圆形遮罩。' });
        }
        walkPosts(portable.post, p => {
          p.author.avatar = copied.get(p.author.avatar) || p.author.avatar;
          p.sourceScreenshot.file = copied.get(p.sourceScreenshot.file) || p.sourceScreenshot.file;
          p.media.forEach(m => { m.file = copied.get(m.file) || m.file; });
        });
        await fs.writeFile(path.join(dir, `${basename}.input.json`), JSON.stringify(portable, null, 2) + '\n');
        let doc = buildDocument(input, template, assets);
        checkGlyphs(doc.texts, fonts, issues);
        report.checks.glyphCoverage = !issues.some(i => i.code === 'GLYPH_MISSING');
        await this.start();
        report.engine.chromium = this.browser.version();
        page = await this.browser.newPage({ viewport: { width: template.width, height: 1 }, deviceScaleFactor: template.scale,
          locale: 'zh-CN', timezoneId: input.displayTimezone, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
        await page.route('**/*', async route => {
          const url = route.request().url();
          const font = fonts.find(f => url === `https://renderer.invalid/fonts/${f.name}`);
          if (font) await route.fulfill({ status: 200, contentType: font.name.endsWith('.otf') ? 'font/otf' : 'font/ttf', body: font.bytes, headers: { 'Access-Control-Allow-Origin': '*' } });
          else await route.abort('blockedbyclient');
        });
        async function display(document) {
          await page.setContent(document.html, { waitUntil: 'load', timeout: 60000 });
          await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all([...document.images].map(img => img.decode()));
          });
        }
        await display(doc);
        const inspect = async () => page.evaluate(() => {
          const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const overflow = [...document.querySelectorAll('[data-check]')].filter(el => el.scrollWidth > el.clientWidth + 1 || (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible')).map(el => el.dataset.check);
          return {
            width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
            card: rect(document.querySelector('#card')),
            translations: [...document.querySelectorAll('[data-translation]')].map(el => ({ field: el.dataset.translation, text: el.textContent, ...rect(el), fontSize: getComputedStyle(el).fontSize, lineHeight: getComputedStyle(el).lineHeight })),
            quotes: [...document.querySelectorAll('[data-quote]')].map(el => el.dataset.quote),
            images: [...document.querySelectorAll('img[data-asset]')].map(el => ({ field: el.dataset.asset, sha256: el.dataset.sha256, role: el.className, src: el.currentSrc, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, ...rect(el) })),
            blocks: [...document.querySelectorAll('[data-check]')].map(el => ({ field: el.dataset.check, ...rect(el) })),
            fontsLoaded: document.fonts.check('40px MVPText') && document.fonts.check('38px MVPText') && document.fonts.check('40px MVPEmoji'),
            overflow
          };
        });
        let layout = await inspect();
        report.checks.translationExact = stable(layout.translations.map(({ field, text }) => ({ field, text }))) === stable(doc.translations);
        if (!report.checks.translationExact) issue(issues, 'error', 'TEXT_CHANGED', 'translation', '渲染后的译文与输入不逐字一致。');
        const expectedQuotes = [];
        walkPosts(input.post, (_, f) => { if (f !== 'post') expectedQuotes.push(f); });
        report.checks.quoteComplete = stable(expectedQuotes) === stable(layout.quotes);
        if (!report.checks.quoteComplete) issue(issues, 'error', 'QUOTE_MISSING', 'post.quote', '渲染内容丢失了引用层级。');
        report.checks.imagesUnchanged = doc.imageExpectations.length === layout.images.length && layout.images.every((img, i) => sha256(Buffer.from(img.src.split(',')[1], 'base64')) === doc.imageExpectations[i].sha256);
        if (!report.checks.imagesUnchanged) issue(issues, 'error', 'IMAGE_CHANGED', 'assets', '嵌入图片与输入文件哈希不一致。');
        report.checks.mediaAspectRatios = layout.images.filter(i => i.role === 'media-image').every(i => Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) < 0.005);
        if (!report.checks.mediaAspectRatios) issue(issues, 'error', 'MEDIA_ASPECT_RATIO', 'media', '配图显示比例与原文件不一致。');
        if (!layout.fontsLoaded) issue(issues, 'error', 'FONT_LOAD_FAILED', 'fonts', '固定字体没有全部载入。');
        report.checks.overflow = layout.overflow;
        if (layout.overflow.length || layout.width !== template.width) issue(issues, 'error', 'TEXT_OVERFLOW', 'layout', `发现溢出：${layout.overflow.join(', ') || '画布宽度超出模板'}`);
        if (layout.height * template.scale > 30000 || layout.width * layout.height * template.scale ** 2 > 100000000) issue(issues, 'error', 'CANVAS_LIMIT', 'layout', '画布超过当前单张 PNG 的安全上限。未缩小字号、截文或分割，请人工拆分原帖。');
        if (mode === 'preview') {
          const errors = issues.filter(i => i.severity === 'error');
          const warning = errors.length ? `警告预览 · 不可发布 · ${errors.length} 项待处理\n${[...new Set(errors.map(e => e.message))].slice(0, 4).join('；')}${errors.length > 4 ? '；完整清单见检查报告。' : ''}` : '预览 · 请对照原帖核对；可发布文件需使用“导出成品”。';
          doc = buildDocument(input, template, assets, { warning });
          await display(doc);
          layout = await inspect();
        }
        report.layout = { ...layout, images: layout.images.map(({ src, ...i }) => i) };
        const blocked = issues.some(i => i.severity === 'error');
        report.publishable = !blocked;
        report.status = blocked ? 'blocked' : 'ready';
        if ((mode === 'preview' || !blocked) && !issues.some(i => i.code === 'CANVAS_LIMIT')) {
          const pngName = `${basename}.${mode === 'preview' ? 'preview' : 'publish'}.png`;
          const bytes = await page.screenshot({ fullPage: true, type: 'png', animations: 'disabled', caret: 'hide', scale: 'device', timeout: 60000 });
          await fs.writeFile(path.join(dir, pngName), bytes);
          report.png = { file: pngName, sha256: sha256(bytes), bytes: bytes.length, width: template.width * template.scale, height: layout.height * template.scale };
        }
      }
    } catch (e) {
      issue(issues, 'error', e.code === 'BROWSER_NOT_INSTALLED' ? e.code : 'RENDER_FAILED', '/', e.message);
      report.status = 'blocked'; report.publishable = false; report.png = null;
    } finally { await page?.close(); }
    const reportName = `${basename}.report.json`;
    await fs.writeFile(path.join(dir, reportName), JSON.stringify(report, null, 2) + '\n');
    const lines = [`检查结果：${report.status === 'ready' ? '已通过自动检查' : '存在阻止发布的问题'}`, `模式：${mode}`, `原帖：${report.sourceUrl || '未知'}`, `模板：${template.version}`, `译文逐字一致：${report.checks.translationExact}`, `引用完整：${report.checks.quoteComplete}`, `图片哈希一致：${report.checks.imagesUnchanged}`, `配图比例保持：${report.checks.mediaAspectRatios}`, '', ...issues.map(i => `[${i.severity}] ${i.code} ${i.field}: ${i.message}`), '', ...report.limitations];
    await fs.writeFile(path.join(dir, `${basename}.report.txt`), lines.join('\n') + '\n');
    const entries = {};
    async function pack(folder, prefix = '') {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (entry.name.endsWith('.zip')) continue;
        const rel = prefix + entry.name;
        if (entry.isDirectory()) await pack(path.join(folder, entry.name), rel + '/');
        else entries[rel] = [new Uint8Array(await fs.readFile(path.join(folder, entry.name))), { level: 0, mtime: new Date('2000-01-01T00:00:00Z') }];
      }
    }
    await pack(dir);
    await fs.writeFile(path.join(dir, `${basename}.bundle.zip`), zipSync(entries));
    return { dir, basename, reportName, report };
  }
}
