import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { at } from './paths.mjs';

export const sha256 = b => createHash('sha256').update(b).digest('hex');
export const stable = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const schema = JSON.parse(await fs.readFile(at('src', 'schema.json'), 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
export const issue = (issues, severity, code, field, message) => issues.push({ severity, code, field, message });

export function walkPosts(post, fn, field = 'post', depth = 0) {
  if (!post || typeof post !== 'object') return;
  fn(post, field);
  if (post.quote && depth < 5) walkPosts(post.quote, fn, `${field}.quote`, depth + 1);
}

export function parseTime(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m || +m[1] < 2000 || +m[1] > 2100 || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59) return null;
  const date = new Date(text);
  if (!Number.isFinite(+date)) return null;
  const offset = m[7] === 'Z' ? 0 : (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(4));
  if (Math.abs(offset) > 14 * 60 || +m[7].slice(4) > 59) return null;
  const local = new Date(+date + offset * 60000);
  if (local.getUTCFullYear() !== +m[1] || local.getUTCMonth() + 1 !== +m[2] || local.getUTCDate() !== +m[3]) return null;
  return { date, offset };
}

export function formatTime(text, zone) {
  const parsed = parseTime(text);
  if (!parsed) return '发布时间未知（需核对）';
  const d = new Date(+parsed.date + (zone === 'Asia/Shanghai' ? 480 : 540) * 60000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}（${zone === 'Asia/Shanghai' ? '北京时间' : '日本时间'}）· ${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function validPostUrl(url, id) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(u.hostname)
      && !u.username && !u.password && new RegExp(`^/(?:[A-Za-z0-9_]+/status|i/status)/${id}/?$`).test(u.pathname);
  } catch { return false; }
}

export function validateInput(input) {
  const issues = [];
  if (!validateSchema(input)) {
    for (const e of validateSchema.errors) issue(issues, 'error', 'SCHEMA', e.instancePath || '/', `${e.message} ${JSON.stringify(e.params)}`);
    return { issues, schemaValid: false };
  }
  if (input.testFixture) issue(issues, 'error', 'TEST_FIXTURE', '/', '演示/测试数据，只允许带警告的预览，不可作为真实译图发布。');
  walkPosts(input.post, (p, f) => {
    if (f.split('.quote').length > 4) issue(issues, 'error', 'QUOTE_DEPTH', f, '引用层数超过 4 层，须单独核对。');
    if (!validPostUrl(p.url, p.id)) issue(issues, 'error', 'POST_URL', `${f}.url`, '必须为与推文 ID 一致的 X/Twitter 永久链接。');
    if (!p.author.name.trim() || !p.author.handle.trim()) issue(issues, 'error', 'AUTHOR_UNKNOWN', `${f}.author`, '昵称与账号不可空白。');
    if (!p.translation.trim() && !(p.relationship.type === 'repost' && p.quote)) issue(issues, 'error', 'TRANSLATION_EMPTY', `${f}.translation`, '译文为空，不能导出成品。');
    if (!p.originalText.trim() && p.translation.trim()) issue(issues, 'error', 'ORIGINAL_UNKNOWN', `${f}.originalText`, '未提供原文，无法核对译文。');
    if (!p.review.translationConfirmed) issue(issues, 'error', 'TRANSLATION_UNREVIEWED', `${f}.review.translationConfirmed`, '请逐字核对译文并确认。');
    if (!p.review.sourceConfirmed) issue(issues, 'error', 'SOURCE_UNREVIEWED', `${f}.review.sourceConfirmed`, '作者、时间、原文、引用层级及互动数字尚未核对。');
    if (!p.sourceScreenshot.file) issue(issues, 'error', 'SCREENSHOT_MISSING', `${f}.sourceScreenshot.file`, '缺少真实原帖截图，参考版式图不能代替它。');
    if (!p.sourceScreenshot.reviewed) issue(issues, 'error', 'SCREENSHOT_UNREVIEWED', `${f}.sourceScreenshot.reviewed`, '原帖截图尚未人工核对。');
    const time = parseTime(p.publishedAt);
    if (!time) issue(issues, 'error', 'TIME_FORMAT', `${f}.publishedAt`, '时间需使用带明确时区偏移的 ISO 8601，例如 2026-10-29T20:29:00+09:00。');
    else if (time.offset !== (p.sourceTimezone === 'Asia/Tokyo' ? 540 : 480)) issue(issues, 'error', 'TIMEZONE_MISMATCH', `${f}.sourceTimezone`, '原始发布时间的时区偏移与 sourceTimezone 不一致。');
    const captured = parseTime(p.sourceScreenshot.capturedAt);
    if (!captured) issue(issues, 'error', 'CAPTURE_TIME', `${f}.sourceScreenshot.capturedAt`, '截图采集时间缺失或格式不正确。');
    else if (time && +captured.date < +time.date) issue(issues, 'error', 'CAPTURE_BEFORE_POST', `${f}.sourceScreenshot.capturedAt`, '截图采集时间早于发布时间。');
    if (p.author.verified && (!p.author.verificationEvidence?.trim() || !p.review.sourceConfirmed)) issue(issues, 'error', 'VERIFICATION_UNCONFIRMED', `${f}.author.verified`, '认证标记缺少已确认的来源；预览也不会显示该标记。');
    if (!p.author.avatar) issue(issues, 'error', 'AVATAR_MISSING', `${f}.author.avatar`, '未提供头像文件。');
    if (p.sourceMediaCount == null) issue(issues, 'error', 'MEDIA_COUNT_UNKNOWN', `${f}.sourceMediaCount`, '请对照原帖确认配图数量。');
    else if (p.sourceMediaCount !== p.media.length) issue(issues, 'error', 'MEDIA_COUNT_MISMATCH', `${f}.media`, '输入配图数与已核对的原帖配图数不符，可能遗漏素材。');
    if (p.sourceQuote === 'unknown') issue(issues, 'error', 'QUOTE_UNKNOWN', `${f}.sourceQuote`, '请对照原帖确认是否存在引用/转推原帖层级。');
    if (p.sourceQuote === 'present' && !p.quote) issue(issues, 'error', 'SOURCE_QUOTE_MISSING', `${f}.quote`, '原帖有引用/转推原帖，但输入未保留该层。');
    if (p.sourceQuote === 'none' && p.quote) issue(issues, 'error', 'SOURCE_QUOTE_MISMATCH', `${f}.sourceQuote`, '输入包含引用层，但原帖核对记录为“无引用”。');
    for (const [i, m] of p.media.entries()) {
      if (m.completeness === 'cropped') issue(issues, 'warning', 'MEDIA_CROPPED', `${f}.media.${i}`, '仅提供了裁切版本；保留现有画面，不生成缺失部分。图上会附提示。');
      if (m.completeness === 'unknown') issue(issues, 'error', 'MEDIA_COMPLETENESS_UNKNOWN', `${f}.media.${i}`, '配图是否完整尚未确认。');
      if (!m.reviewed) issue(issues, 'error', 'MEDIA_UNREVIEWED', `${f}.media.${i}`, '配图文件和顺序尚未核对。');
    }
    for (const key of ['views', 'replies', 'reposts', 'likes', 'bookmarks']) {
      const value = p.metrics?.[key];
      if (value == null || value === '') issue(issues, 'info', 'METRIC_UNKNOWN', `${f}.metrics.${key}`, '未提供，保持留空。');
      else if (typeof value === 'string' && !/^\d+(?:\.\d+)?(?:万|亿|[kKmM])?$/.test(value)) issue(issues, 'error', 'METRIC_FORMAT', `${f}.metrics.${key}`, '互动数字仅接受非负数字或原截图中明确的缩写，如 4.4万。');
    }
    if (p.relationship.type !== 'original') {
      const r = p.relationship;
      const targetId = /\/status\/(\d+)/.exec(r.url || '')?.[1];
      const relationshipComplete = r.authorName?.trim() && r.authorHandle?.trim() && targetId && validPostUrl(r.url, targetId);
      if (!relationshipComplete) issue(issues, 'error', 'RELATIONSHIP_UNKNOWN', `${f}.relationship`, '回复/转推必须填写关系、原作者昵称、账号和原帖永久链接。');
      if (r.type === 'repost' && !p.quote) issue(issues, 'error', 'REPOST_ORIGINAL_MISSING', `${f}.quote`, '转推必须在 quote 中保留完整原帖，不能当作当前作者的原创。');
      if (r.type === 'repost' && p.quote && relationshipComplete && (r.url !== p.quote.url || r.authorHandle.replace(/^@/, '') !== p.quote.author.handle.replace(/^@/, '') || r.authorName !== p.quote.author.name)) issue(issues, 'error', 'REPOST_AUTHOR_MISMATCH', `${f}.relationship`, '转推关系中的原帖和原作者必须与 quote 一致。');
    }
  });
  return { issues, schemaValid: true };
}

export async function loadAssets(input, baseDir, issues, allowedRoot) {
  const assets = new Map();
  const rootReal = allowedRoot ? await fs.realpath(allowedRoot) : null;
  async function load(file, field, role) {
    if (!file) return;
    if (assets.has(file)) { assets.get(file).uses.push({ field, role }); return; }
    try {
      if (/^(?:https?:|data:|file:)/i.test(file)) throw new Error('素材必须是本地文件，不能使用远程链接或 data URL。');
      const full = await fs.realpath(path.resolve(baseDir, file));
      const rel = rootReal ? path.relative(rootReal, full) : '';
      if (rootReal && (rel.startsWith('..') || path.isAbsolute(rel))) throw new Error('网页只允许读取已上传到本项目的文件。');
      const stat = await fs.stat(full);
      if (stat.size > 40 * 1024 * 1024) throw new Error('单张素材超过 40 MiB。');
      const bytes = await fs.readFile(full);
      const meta = await sharp(bytes, { limitInputPixels: 80000000 }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error('仅支持静态 PNG、JPEG、WebP；请先提供确认过的静态图片。');
      if ((meta.pages || 1) > 1) throw new Error('动画素材不能静默截取首帧，请提供确认过的静态版本。');
      const swapped = [5, 6, 7, 8].includes(meta.orientation);
      assets.set(file, { file, full, bytes, sha256: sha256(bytes), format: meta.format,
        width: swapped ? meta.height : meta.width, height: swapped ? meta.width : meta.height,
        mime: `image/${meta.format}`, uses: [{ field, role }] });
    } catch (e) { issue(issues, 'error', 'ASSET_INVALID', field, `素材读取失败：${e.message}`); }
  }
  const jobs = [];
  walkPosts(input.post, (p, f) => {
    jobs.push([p.author.avatar, `${f}.author.avatar`, 'avatar']);
    jobs.push([p.sourceScreenshot.file, `${f}.sourceScreenshot.file`, 'sourceScreenshot']);
    p.media.forEach((m, i) => jobs.push([m.file, `${f}.media.${i}.file`, 'media']));
  });
  // Sequential insertion fixes manifest and output ordering, including shared assets.
  for (const job of jobs) await load(...job);
  const total = [...assets.values()].reduce((n, a) => n + a.bytes.length, 0);
  if (total > 200 * 1024 * 1024) issue(issues, 'error', 'ASSETS_TOO_LARGE', 'assets', '素材合计超过 200 MiB，请减小文件体积或分批处理。');
  const referenceHash = sha256(await fs.readFile(at('reference', 'mvp.jpg')));
  for (const a of assets.values()) if (a.sha256 === referenceHash && a.uses.some(u => u.role === 'sourceScreenshot')) {
    issue(issues, 'error', 'REFERENCE_IS_NOT_SOURCE', 'sourceScreenshot', '版式参考图不是对应推文的真实原帖截图，不能代替来源核对。');
  }
  return assets;
}

let fonts;
export async function loadFonts() {
  if (fonts) return fonts;
  const manifest = JSON.parse(await fs.readFile(at('assets', 'fonts', 'manifest.json'), 'utf8'));
  fonts = [];
  for (const name of ['NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf', 'NotoColorEmoji.ttf']) {
    const bytes = await fs.readFile(at('assets', 'fonts', name));
    if (sha256(bytes) !== manifest[name].sha256) throw new Error(`字体校验失败：${name}，请运行 npm run setup。`);
    fonts.push({ name, bytes, sha256: sha256(bytes), face: fontkit.create(bytes) });
  }
  return fonts;
}

export function checkGlyphs(strings, fontList, issues) {
  const missing = new Set();
  for (const text of strings) for (const char of text) {
    const cp = char.codePointAt(0);
    if ([9, 10, 13, 0x200d, 0xfe0e, 0xfe0f].includes(cp) || (cp >= 0xe0020 && cp <= 0xe007f)) continue;
    if (cp === 0xfffd || cp < 32 || /[\uD800-\uDFFF]/u.test(char) || !fontList.some(f => f.face.hasGlyphForCodePoint(cp))) missing.add(char);
  }
  for (const char of missing) issue(issues, 'error', 'GLYPH_MISSING', 'renderedText', `固定字体不能可靠显示：${char} (U+${char.codePointAt(0).toString(16).toUpperCase()})。`);
}

export async function loadTemplate(file = at('template.json')) {
  const template = JSON.parse(await fs.readFile(file, 'utf8'));
  const defaults = JSON.parse(await fs.readFile(at('template.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(at('template-lock.json'), 'utf8'));
  if (sha256(stable(defaults)) !== lock.configSha256 || sha256(await fs.readFile(at('src', 'template.mjs'))) !== lock.sourceSha256 || sha256(await fs.readFile(at('reference', 'mvp.jpg'))) !== lock.referenceSha256) throw new Error('默认模板/参考图与锁文件不一致。请恢复文件，或按 README 升级模板版本后重建锁。');
  if (stable(template) !== stable(defaults) && template.version === defaults.version) throw new Error('模板参数变更后必须修改 version，避免同版本对应不同版式。');
  if (typeof template.version !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(template.version)) throw new Error('模板版本格式无效。');
  for (const key of ['width', 'scale', 'paddingX', 'paddingTop', 'paddingBottom', 'avatar', 'headerGap', 'nameSize', 'handleSize', 'labelSize', 'labelMargin', 'bodySize', 'bodyLineHeight', 'bodyMargin', 'timeSize', 'timeMargin', 'actionsSize', 'actionsMargin', 'mediaGap', 'mediaMargin', 'mediaColumns', 'quotePadding']) {
    if (!Number.isFinite(template[key]) || template[key] <= 0) throw new Error(`模板参数无效：${key}`);
  }
  if (template.width > 4000 || template.scale > 3 || template.mediaColumns !== 2 || template.bodyLineHeight < template.bodySize || template.width < template.paddingX * 2 + template.avatar + 200) throw new Error('模板尺寸或行距超出安全范围。');
  for (const key of ['text', 'muted', 'translationColor', 'background', 'quoteBorder']) if (!/^#[0-9a-f]{6}$/i.test(template[key])) throw new Error(`模板颜色无效：${key}`);
  if (template.background.toLowerCase() !== '#ffffff') throw new Error('本模板要求白色背景。');
  return template;
}

export function safeName(text, length = 24) {
  return String(text).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, length) || 'unknown';
}
