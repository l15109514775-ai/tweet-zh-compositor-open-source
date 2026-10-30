const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function blankPost() {
  return { id: '', url: '', author: { name: '', handle: '', avatar: null, verified: false, verificationEvidence: null }, originalText: '', translation: '', publishedAt: '', sourceTimezone: 'Asia/Tokyo', sourceScreenshot: { file: null, capturedAt: null, reviewed: false }, sourceMediaCount: null, sourceQuote: 'unknown', media: [], quote: null, relationship: { type: 'original' }, metrics: {}, notes: [], review: { translationConfirmed: false, sourceConfirmed: false } };
}
let input = { schemaVersion: 1, displayTimezone: 'Asia/Tokyo', post: blankPost() };
let assets = [];
let rendered = false;
let inputRevision = 0;
const get = p => p.split('.').reduce((v, k) => v?.[k], input);
function set(p, v) { const ks = p.split('.'); const key = ks.pop(); let obj = input; for (const k of ks) obj = obj[k] ??= {}; obj[key] = v; }
const field = (label, p, options = {}) => `<label class="field ${options.className || ''}"><span>${esc(label)}</span>${options.textarea ? `<textarea data-path="${p}" rows="${options.rows || 3}" spellcheck="false">${esc(get(p))}</textarea>` : `<input data-path="${p}" value="${esc(get(p))}" placeholder="${esc(options.placeholder || '')}" ${options.readonly ? 'readonly' : ''}>`}</label>`;
const check = (label, p) => `<label class="check"><input type="checkbox" data-path="${p}" ${get(p) ? 'checked' : ''}>${esc(label)}</label>`;
const select = (label, p, opts) => `<label class="field"><span>${esc(label)}</span><select data-path="${p}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${get(p) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
function assetSelect(label, p) {
  const value = get(p);
  const opts = [['', '请选择已上传文件'], ...assets.map(a => [a.file, a.name.length > 45 ? a.name.slice(0, 40) + '…' : a.name])];
  if (value && !assets.some(a => a.file === value)) opts.push([value, value]);
  return select(label, p, opts);
}
function formPost(p = 'post', depth = 0) {
  const post = get(p);
  const relation = post.relationship?.type || 'original';
  const metrics = [['replies', '回复'], ['reposts', '转推'], ['likes', '喜欢'], ['bookmarks', '书签'], ['views', '浏览']];
  return `<section class="post-form" data-post="${p}"><div class="post-title"><h3>${depth ? `引用帖 · 第 ${depth} 层` : '当前推文'}</h3>${depth ? `<button class="remove" data-action="remove-quote" data-target="${p}">移除引用</button>` : ''}</div>
    <div class="row">${field('推文 ID', `${p}.id`, { placeholder: '原帖的数字 ID' })}${field('原帖永久链接', `${p}.url`, { placeholder: 'https://x.com/账号/status/ID' })}</div>
    <div class="row">${field('作者昵称', `${p}.author.name`)}${field('作者账号', `${p}.author.handle`, { placeholder: '@account' })}</div>${assetSelect('头像文件（原文件，模板内显示为圆形）', `${p}.author.avatar`)}
    ${check('来源已确认存在认证标记', `${p}.author.verified`)}${field('认证来源说明（未确认时留空）', `${p}.author.verificationEvidence`)}
    ${select('帖子关系', `${p}.relationship.type`, [['original', '原创 / 引用发言'], ['reply', '回复'], ['repost', '转推（须在引用层保留原帖）']])}
    ${relation === 'original' ? '' : `<div class="row">${field('关系中的原作者昵称', `${p}.relationship.authorName`)}${field('关系中的原作者账号', `${p}.relationship.authorHandle`)}</div>${field('关系中的原帖永久链接', `${p}.relationship.url`)}`}
    ${field('原文（核对依据，不自动翻译）', `${p}.originalText`, { textarea: true })}
    ${field('中文译文（保持输入的文字和换行）', `${p}.translation`, { textarea: true, className: 'translation', rows: 5 })}
    <div class="row">${field('原始发布时间（带时区）', `${p}.publishedAt`, { placeholder: '2026-10-29T20:29:00+09:00' })}${select('原始发布时间的时区', `${p}.sourceTimezone`, [['Asia/Tokyo', '日本 UTC+09:00'], ['Asia/Shanghai', '北京 UTC+08:00']])}</div>
    ${assetSelect('真实原帖截图（与版式参考分开保留）', `${p}.sourceScreenshot.file`)}${field('截图采集时间（带时区）', `${p}.sourceScreenshot.capturedAt`, { placeholder: '2026-10-29T20:35:00+09:00' })}
    <div class="row">${select('原帖配图数量（核对后选择）', `${p}.sourceMediaCount`, [['', '尚未确认'], ...[0, 1, 2, 3, 4].map(n => [n, `${n} 张`])])}${select('引用/转推原帖层级（核对后选择）', `${p}.sourceQuote`, [['unknown', '尚未确认'], ['none', '无引用层'], ['present', '有引用/转推原帖层']])}</div>
    <div class="media-head"><strong>配图 ${post.media.length}/4</strong>${post.media.length < 4 ? `<button data-action="add-media" data-target="${p}">＋ 配图</button>` : ''}</div>
    ${post.media.map((m, i) => `<div class="media-item"><div class="media-head"><small>第 ${i + 1} 张 · 按此顺序排版</small><button class="remove" data-action="remove-media" data-target="${p}" data-index="${i}">移除</button></div>${assetSelect('配图文件', `${p}.media.${i}.file`)}${select('画面完整性', `${p}.media.${i}.completeness`, [['unknown', '尚未确认'], ['complete', '确认是完整画面'], ['cropped', '只有裁切版本（图上附提示）']])}${field('可选图片说明', `${p}.media.${i}.caption`)}${check('已核对这张配图及其顺序', `${p}.media.${i}.reviewed`)}</div>`).join('')}
    <details><summary>可选互动数字与译注</summary><p class="note">未提供的数字留空；不要复制参考图里的数字。</p><div class="metrics">${metrics.map(([k, label]) => field(label, `${p}.metrics.${k}`)).join('')}</div>${field('译注（每行一条，不修改正文中的相对时间）', `${p}.notes`, { textarea: true, rows: 2 })}</details>
    <div class="checks"><strong>人工核对记录</strong>${check('已对照真实原帖核对截图', `${p}.sourceScreenshot.reviewed`)}${check('已核对作者、时间、原文、引用层级和已填写的互动数字', `${p}.review.sourceConfirmed`)}${check('已逐字核对中文译文', `${p}.review.translationConfirmed`)}</div>
    ${post.quote ? formPost(`${p}.quote`, depth + 1) : depth < 3 ? `<button data-action="add-quote" data-target="${p}">＋ 引用帖 / 转推原帖</button>` : ''}</section>`;
}
function syncJson() { $('#jsonEditor').value = JSON.stringify(input, null, 2); }
function refresh() {
  // Notes are stored as an array in JSON, shown as one note per line in the form.
  $('#form').innerHTML = formPost();
  document.querySelectorAll('[data-path$=".notes"]').forEach(el => { el.value = (get(el.dataset.path) || []).join('\n'); });
  $('#displayTimezone').value = input.displayTimezone;
  $('#assetList').textContent = assets.length ? `已上传 ${assets.length} 个素材：${assets.map(a => a.name).join('、')}` : '尚未上传素材';
  syncJson(); showSources();
}
function stale() {
  inputRevision++;
  $('#downloads').replaceChildren();
  if (rendered) $('#status').textContent = '数据已修改，请重新生成。下方仍为修改前的预览。';
}
function applyChange(el) {
  const p = el.dataset.path; if (!p) return;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (p.endsWith('.notes')) value = value ? value.split('\n') : [];
  else if (p.endsWith('.sourceMediaCount')) value = value === '' ? null : Number(value);
  else if (value === '' && /\.(avatar|verificationEvidence|capturedAt|file)$/.test(p)) value = null;
  else if (p.includes('.metrics.') && value === '') value = null;
  set(p, value);
  const postPath = el.closest('[data-post]')?.dataset.post;
  if (postPath && (p.endsWith('.translation') || p.endsWith('.originalText'))) { set(`${postPath}.review.translationConfirmed`, false); const checkbox = document.querySelector(`[data-path="${postPath}.review.translationConfirmed"]`); if (checkbox) checkbox.checked = false; }
  if (/\.sourceScreenshot\.(file|capturedAt)$/.test(p)) {
    set(`${postPath}.sourceScreenshot.reviewed`, false);
    document.querySelector(`[data-path="${postPath}.sourceScreenshot.reviewed"]`).checked = false;
  }
  if (/\.media\.\d+\.(file|completeness|caption)$/.test(p)) {
    const reviewed = p.slice(0, p.lastIndexOf('.')) + '.reviewed'; set(reviewed, false);
    const checkbox = document.querySelector(`[data-path="${reviewed}"]`); if (checkbox) checkbox.checked = false;
  }
  if (!p.includes('.review.') && !p.endsWith('.reviewed') && !p.endsWith('.translation') && !p.endsWith('.notes')) {
    const closest = el.closest('[data-post]')?.dataset.post;
    if (closest) { set(`${closest}.review.sourceConfirmed`, false); const checkbox = document.querySelector(`[data-path="${closest}.review.sourceConfirmed"]`); if (checkbox) checkbox.checked = false; }
  }
  syncJson(); stale();
  if (p.endsWith('.relationship.type')) refresh();
  if (p.endsWith('.sourceScreenshot.file')) showSources();
}
$('#form').addEventListener('input', e => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') applyChange(e.target); });
$('#form').addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') applyChange(e.target); });
$('#form').addEventListener('click', e => {
  const button = e.target.closest('[data-action]'); if (!button) return;
  const p = button.dataset.target; const post = get(p);
  if (button.dataset.action === 'add-media' && post.media.length < 4) post.media.push({ file: '', completeness: 'unknown', reviewed: false });
  if (button.dataset.action === 'remove-media') post.media.splice(+button.dataset.index, 1);
  if (button.dataset.action === 'add-quote') { post.quote = blankPost(); post.sourceQuote = 'present'; }
  if (button.dataset.action === 'remove-quote') { set(p, null); set(p.slice(0, -6) + '.sourceQuote', 'unknown'); }
  if (post?.review) post.review.sourceConfirmed = false;
  stale(); refresh();
});
async function jsonFetch(url, options) {
  const res = await fetch(url, options); const result = await res.json(); if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`); return result;
}
function notifyError(e) { $('#status').textContent = `操作未完成：${e.message}`; }
$('#uploads').addEventListener('change', async e => {
  try {
    for (const file of e.target.files) {
      const result = await jsonFetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file });
      const old = assets.find(a => a.file === result.file); if (old) old.name = result.name; else assets.push(result);
    }
    refresh(); $('#status').textContent = '素材已保留原文件；请选择对应的头像、截图和配图。';
  } catch (e) { notifyError(e); } finally { $('#uploads').value = ''; }
});
function acceptInput(parsed) {
  if (Array.isArray(parsed)) throw new Error('网页一次编辑一条推文；JSON 数组请用批量命令行。');
  if (!parsed || parsed.schemaVersion !== 1 || !parsed.post) throw new Error('需要 schemaVersion: 1 和 post，格式见 README。');
  function defaults(p, depth = 0) {
    if (depth > 3 || !p || typeof p !== 'object') throw new Error('引用格式不正确或超过 4 层。');
    if (!p.author || !Array.isArray(p.media) || !p.review || !p.sourceScreenshot || !p.relationship) throw new Error('输入缺少 author/media/review/sourceScreenshot/relationship 字段。');
    p.metrics ??= {}; p.notes ??= [];
    if (p.quote) defaults(p.quote, depth + 1);
  }
  defaults(parsed.post); input = parsed; stale(); refresh();
}
$('#import').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => { try { const f = e.target.files[0]; if (f) acceptInput(JSON.parse((await f.text()).replace(/^\uFEFF/, ''))); } catch (e) { notifyError(e); } e.target.value = ''; };
$('#applyJson').onclick = () => { try { acceptInput(JSON.parse($('#jsonEditor').value)); } catch (e) { notifyError(e); } };
function save(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('#saveJson').onclick = () => save(new Blob([JSON.stringify(input, null, 2) + '\n'], { type: 'application/json' }), `${(input.post.author.handle || 'author').replace(/[^\w\u3040-\u9fff-]/g, '_')}_${input.post.id || 'draft'}.input.json`);
$('#example').onclick = async () => { try { const data = await jsonFetch('/api/example', { method: 'POST' }); assets = await jsonFetch('/api/assets'); acceptInput(data); $('#status').textContent = '已载入测试数据；它只能生成标有“不可发布”的预览。'; } catch (e) { notifyError(e); } };
$('#displayTimezone').onchange = e => { input.displayTimezone = e.target.value; stale(); syncJson(); };
function showSources() {
  const html = [];
  function add(p, label) { if (p.sourceScreenshot.file) html.push(`<p class="source-label">${esc(label)} · 采集时间：${esc(p.sourceScreenshot.capturedAt || '未知')}</p><img src="/api/asset?file=${encodeURIComponent(p.sourceScreenshot.file)}" alt="${esc(label)}原帖截图">`); if (p.quote) add(p.quote, `${label}的引用帖`); }
  add(input.post, '当前推文'); $('#sourceImages').innerHTML = html.join('');
}
async function render(mode) {
  const requestRevision = inputRevision;
  const snapshot = structuredClone(input);
  const buttons = [$('#preview'), $('#publish')]; buttons.forEach(b => b.disabled = true);
  rendered = false;
  $('#status').textContent = '正在载入固定字体、渲染并检查……'; $('#downloads').replaceChildren();
  $('#previewPane').innerHTML = '<div class="empty">正在生成当前数据的译图……</div>';
  $('#report').replaceChildren();
  try {
    const result = await jsonFetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: snapshot, mode }) });
    if (inputRevision !== requestRevision) {
      $('#status').textContent = '处理期间数据已修改，本次旧结果已丢弃，请重新生成。';
      $('#previewPane').innerHTML = '<div class="empty">请用修改后的数据重新生成。</div>';
      return;
    }
    rendered = true;
    $('#previewPane').innerHTML = result.png ? `<img src="${esc(result.png)}" alt="${mode === 'preview' ? '带明确警告的译图预览' : '通过检查的译图'}">` : '<div class="empty">检查未通过，未输出成品 PNG。请处理下方问题。</div>';
    $('#status').textContent = `${result.report.status === 'ready' ? mode === 'preview' ? '预览完成，自动检查通过。' : '成品已导出，请完成人工核对后手动发布。' : '存在阻止发布的问题。'} 文件：${result.directory}`;
    const links = [[result.bundle, '下载完整包（含素材）'], [result.input, '输入 JSON'], [result.reportText, '检查报告'], [result.reportJson, '报告 JSON']];
    if (result.downloadPng) links.unshift([result.downloadPng, mode === 'preview' ? '下载警告预览 PNG' : '下载高清 PNG']);
    $('#downloads').innerHTML = links.map(([url, label]) => `<a href="${esc(url)}">${label}</a>`).join('');
    const c = result.report.checks;
    $('#report').innerHTML = `<div class="check-results">译文逐字一致：${c.translationExact ? '通过' : '未通过'} · 引用完整：${c.quoteComplete ? '通过' : '未通过'}<br>素材哈希一致：${c.imagesUnchanged ? '通过' : '未通过'} · 配图比例保持：${c.mediaAspectRatios ? '通过' : '未通过'} · 缺字检查：${c.glyphCoverage ? '通过' : '未通过'}</div><ul class="report-issues">${result.report.issues.map(i => `<li class="${esc(i.severity)}"><strong>${esc(i.code)}</strong> ${esc(i.message)}<br><small>${esc(i.field)}</small></li>`).join('')}</ul>`;
  } catch (e) {
    if (inputRevision !== requestRevision) $('#status').textContent = '处理期间数据已修改，请用当前数据重新生成。';
    else notifyError(e);
    $('#previewPane').innerHTML = '<div class="empty">本次生成未完成，请重新生成。</div>';
  } finally { buttons.forEach(b => b.disabled = false); }
}
$('#preview').onclick = () => render('preview'); $('#publish').onclick = () => render('publish');
try { assets = await jsonFetch('/api/assets'); } catch (e) { notifyError(e); }
refresh();
