import { formatTime } from './core.mjs';
export const escapeHTML = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\r', '&#13;');
const segments = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export function richText(text) {
  return [...segments.segment(String(text ?? ''))].map(({ segment }) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)
    ? `<span class="emoji">${escapeHTML(segment)}</span>` : escapeHTML(segment)).join('');
}
const paths = {
  reply: '<path d="M21 5C10 5 4 11 4 20c0 7 4 12 11 14l-1 8 10-7c10 0 17-6 17-15S33 5 21 5Z"/>',
  repost: '<path d="M5 15 12 8l7 7M12 9v24q0 5 5 5h9M43 33l-7 7-7-7M36 39V15q0-5-5-5h-9"/>',
  like: '<path d="M24 41 7 25C-7 10 13-2 24 12 35-2 55 10 41 25Z"/>',
  bookmark: '<path d="M10 43V8q0-4 4-4h20q4 0 4 4v35L24 33Z"/>',
  share: '<path d="M24 30V5M14 15 24 5l10 10M7 31v10q0 3 3 3h28q3 0 3-3V31"/>',
  translate: '<path d="M8 37 39 6M6 25C4 7 21 1 32 8M40 22c2 17-15 23-26 15"/>',
  more: '<circle cx="10" cy="24" r="3" fill="currentColor" stroke="none"/><circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/><circle cx="38" cy="24" r="3" fill="currentColor" stroke="none"/>'
};
export const icon = (name, size = 44) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
const verified = '<svg class="verified" aria-label="来源已确认的认证标记" width="40" height="40" viewBox="0 0 40 40"><path fill="#1d9bf0" d="M20 1 26 4 32 5 35 11 39 16 37 23 36 30 29 33 24 38 17 37 10 35 7 29 2 24 3 17 5 10 12 7 16 2Z"/><path d="m12 20 6 6 11-13" stroke="white" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function buildDocument(input, template, assets, { warning = null } = {}) {
  const t = template;
  const texts = [];
  const translations = [];
  const imageExpectations = [];
  const push = str => { texts.push(String(str ?? '')); return richText(str); };
  function image(file, field, role, alt) {
    const a = assets.get(file);
    if (!a) return `<div class="missing ${role}" data-check="${escapeHTML(field)}">缺少${alt}</div>`;
    imageExpectations.push({ field, role, sha256: a.sha256, width: a.width, height: a.height });
    return `<img class="${role}" data-asset="${escapeHTML(field)}" data-sha256="${a.sha256}" alt="${escapeHTML(alt)}" src="data:${a.mime};base64,${a.bytes.toString('base64')}">`;
  }
  function postHTML(p, field = 'post', depth = 0) {
    const relation = p.relationship.type === 'original' ? '' : `<div class="relationship" data-check="${field}.relationship">${push(p.relationship.type === 'reply' ? '回复' : '转推自')} ${push(p.relationship.authorName || '原作者未知')} ${push(p.relationship.authorHandle ? `@${p.relationship.authorHandle.replace(/^@/, '')}` : '账号未知')}<div class="relationship-url">${push(p.relationship.url || '原帖链接未知')}</div></div>`;
    const badge = p.author.verified && p.author.verificationEvidence?.trim() && p.review.sourceConfirmed ? verified : '';
    const header = `<header class="header" data-check="${field}.header">${image(p.author.avatar, `${field}.author.avatar`, 'avatar', '头像')}<div class="identity"><div class="name" data-check="${field}.author.name"><span>${push(p.author.name)}</span>${badge}</div><div class="handle" data-check="${field}.author.handle">${push(`@${p.author.handle.replace(/^@/, '')}`)}</div></div><span class="more">${icon('more')}</span></header>`;
    translations.push({ field: `${field}.translation`, text: p.translation });
    const body = `<div class="body" data-translation="${field}.translation" data-check="${field}.translation">${push(p.translation)}</div>`;
    const media = p.media.length ? `<div class="media-grid ${p.media.length === 1 ? 'single' : ''}">${p.media.map((m, i) => `<figure data-check="${field}.media.${i}">${image(m.file, `${field}.media.${i}.file`, 'media-image', `配图 ${i + 1}`)}${m.caption ? `<figcaption>${push(m.caption)}</figcaption>` : ''}${m.completeness === 'cropped' ? '<figcaption class="crop-warning">配图仅有裁切版本 · 未补全</figcaption>' : ''}</figure>`).join('')}</div>` : '';
    const quote = p.quote && depth < 4 ? `<section class="quote" data-quote="${field}.quote" data-check="${field}.quote"><div class="quote-label">${p.relationship.type === 'repost' ? '转推原帖' : '引用帖'}</div>${postHTML(p.quote, `${field}.quote`, depth + 1)}</section>` : '';
    const notes = p.notes?.length ? `<div class="notes" data-check="${field}.notes">${p.notes.map(n => `<div>译注：${push(n)}</div>`).join('')}</div>` : '';
    const views = p.metrics?.views;
    const timestamp = `<div class="timestamp" data-check="${field}.publishedAt">${push(formatTime(p.publishedAt, input.displayTimezone))}${views == null || views === '' ? '' : ` · <b>${push(views)}</b> 浏览量`}</div>`;
    const actions = `<div class="actions" data-check="${field}.metrics">${['replies', 'reposts', 'likes', 'bookmarks'].map((key, i) => `<div class="action" data-check="${field}.metrics.${key}">${icon(['reply', 'repost', 'like', 'bookmark'][i])}<span class="count" data-metric="${field}.${key}">${push(p.metrics?.[key] ?? '')}</span></div>`).join('')}<div class="action share">${icon('share')}</div></div>`;
    return `${relation}${header}${depth === 0 ? `<div class="translation-label">${icon('translate', 40)}<span>${push('中文翻译·非原图')}</span></div>` : ''}${body}${media}${quote}${notes}${timestamp}${actions}`;
  }
  const post = postHTML(input.post);
  const warningHTML = warning ? `<aside class="preview-warning">${escapeHTML(warning)}</aside>` : '';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src https://renderer.invalid; style-src 'unsafe-inline';"><style>
@font-face{font-family:MVPText;src:url('https://renderer.invalid/fonts/NotoSansCJKsc-Regular.otf');font-weight:400;font-display:block}
@font-face{font-family:MVPText;src:url('https://renderer.invalid/fonts/NotoSansCJKsc-Bold.otf');font-weight:700;font-display:block}
@font-face{font-family:MVPEmoji;src:url('https://renderer.invalid/fonts/NotoColorEmoji.ttf');font-weight:400 700;font-display:block}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:${t.width}px;background:${t.background};color:${t.text};font-family:MVPText,MVPEmoji; font-synthesis:none}body{overflow:visible}#card{width:${t.width}px;padding:${t.paddingTop}px ${t.paddingX}px ${t.paddingBottom}px;display:flow-root}
.emoji{font-family:MVPEmoji,MVPText;font-weight:400;display:inline-block;height:1em;line-height:1;vertical-align:-.1em}svg{flex-shrink:0;display:block}.header{display:flex;gap:${t.headerGap}px;min-height:${t.avatar}px;align-items:flex-start}.avatar{display:block;width:${t.avatar}px;height:${t.avatar}px;object-fit:contain;border-radius:50%;flex-shrink:0}.missing{color:#a34b00;border:2px dashed #c7893c;background:#fff7e9;font-size:24px;overflow-wrap:anywhere;white-space:normal}.missing.avatar{display:flex;align-items:center;justify-content:center}.identity{min-width:0;flex:1;padding-top:2px}.name{font-size:${t.nameSize}px;font-weight:700;line-height:50px;display:flex;align-items:center;gap:12px;overflow-wrap:anywhere;white-space:pre-wrap}.name>span{min-width:0}.handle{font-size:${t.handleSize}px;line-height:50px;color:${t.muted};overflow-wrap:anywhere;white-space:pre-wrap}.more{color:${t.muted};margin-left:auto;padding-top:6px}.translation-label{margin-top:${t.labelMargin}px;font-size:${t.labelSize}px;line-height:44px;display:flex;align-items:center;gap:17px;color:${t.translationColor}}.translation-label>svg{color:${t.muted}}.body{font-size:${t.bodySize}px;line-height:${t.bodyLineHeight}px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;margin-top:${t.bodyMargin}px;min-height:${t.bodyLineHeight}px}
.timestamp{font-size:${t.timeSize}px;line-height:46px;color:${t.muted};margin-top:${t.timeMargin}px;overflow-wrap:anywhere}.timestamp b{color:${t.text};font-weight:700}.actions{margin-top:${t.actionsMargin}px;padding:0 12px;display:grid;grid-template-columns:24.5% 25.5% 29% 18% 3%;min-height:52px;color:${t.muted};align-items:center}.action{display:flex;align-items:center;gap:12px;min-width:0;font-size:${t.actionsSize}px;line-height:44px}.count{min-width:0;overflow-wrap:anywhere}.share{justify-content:flex-end}
.media-grid{margin-top:${t.mediaMargin}px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${t.mediaGap}px;align-items:start}.media-grid.single{grid-template-columns:minmax(0,1fr)}figure{margin:0;min-width:0}.media-image{display:block;width:100%;height:auto;object-fit:contain}.missing.media-image{min-height:180px;padding:24px}figcaption{font-size:24px;line-height:36px;white-space:pre-wrap;overflow-wrap:anywhere;color:${t.muted};margin-top:8px}.crop-warning{color:#a34b00}.quote{border:2px solid ${t.quoteBorder};border-radius:18px;padding:${t.quotePadding}px;margin-top:24px;min-width:0}.quote-label{font-size:26px;color:${t.muted};margin-bottom:16px}.quote>.header .avatar{width:74px;height:74px}.quote>.header{min-height:80px}.quote>.header .name{font-size:32px;line-height:42px}.quote>.header .handle{font-size:30px;line-height:40px}.quote>.header .more{display:none}.quote>.timestamp{font-size:26px;line-height:38px}.quote>.actions{font-size:26px;margin-top:24px}.quote>.actions .action{font-size:26px;gap:8px}.quote>.actions svg{width:34px;height:34px}.quote .body{font-size:${t.bodySize}px;line-height:${t.bodyLineHeight}px}.relationship{font-size:26px;color:${t.muted};line-height:38px;overflow-wrap:anywhere;margin-bottom:18px}.relationship-url{font-size:22px}.notes{font-size:28px;line-height:42px;color:${t.muted};white-space:pre-wrap;overflow-wrap:anywhere;margin-top:24px}.preview-warning{background:#fff1cc;color:#833a00;border-bottom:3px solid #cf8d24;padding:16px ${t.paddingX}px;font-size:24px;line-height:36px;white-space:pre-wrap;overflow-wrap:anywhere}
</style></head><body>${warningHTML}<main id="card">${post}</main></body></html>`;
  return { html, texts, translations, imageExpectations };
}
