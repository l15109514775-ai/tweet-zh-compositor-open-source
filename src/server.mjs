import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { at, ROOT } from './paths.mjs';
import { Renderer } from './renderer.mjs';
import { sha256, walkPosts } from './core.mjs';
import sharp from 'sharp';
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须为 1024–65535。');
const workspace = at('workspace');
await fs.mkdir(path.join(workspace, 'uploads'), { recursive: true });
const renderer = new Renderer();
const jobs = new Map();
let busy = false;
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
async function readBody(req, limit = 4 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('请求体过大。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function serveFile(res, file, download = false) {
  const bytes = await fs.readFile(file);
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length,
    ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` } : {}) });
  res.end(bytes);
}
async function assetPath(file) {
  if (!file || /^(https?:|data:|file:)/i.test(file)) throw new Error('素材路径无效。');
  const full = await fs.realpath(path.resolve(workspace, file));
  const rel = path.relative(await fs.realpath(workspace), full);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !/\.(png|jpg|webp)$/i.test(full)) throw new Error('禁止访问项目上传区之外的文件。');
  return full;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  const host = req.headers.host;
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return send(res, 403, { error: '仅接受本机地址。' });
  const origin = req.headers.origin;
  if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return send(res, 403, { error: '拒绝跨站请求。' });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      return await serveFile(res, at('web', url.pathname === '/' ? 'index.html' : url.pathname.slice(1)));
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, localOnly: true });
    if (req.method === 'GET' && url.pathname === '/api/reference') return await serveFile(res, at('reference', 'mvp.jpg'));
    if (req.method === 'GET' && url.pathname === '/api/assets') {
      const files = (await fs.readdir(path.join(workspace, 'uploads'))).filter(n => /\.(png|jpg|webp)$/.test(n));
      return send(res, 200, files.map(n => ({ file: `uploads/${n}`, name: n })));
    }
    if (req.method === 'GET' && url.pathname === '/api/asset') return await serveFile(res, await assetPath(url.searchParams.get('file')));
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const bytes = await readBody(req, 40 * 1024 * 1024);
      const meta = await sharp(bytes, { limitInputPixels: 80000000 }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('请上传静态 PNG、JPEG 或 WebP 文件。');
      const filename = `${sha256(bytes)}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
      await fs.writeFile(path.join(workspace, 'uploads', filename), bytes);
      return send(res, 200, { file: `uploads/${filename}`, name: decodeURIComponent(req.headers['x-filename'] || filename) });
    }
    if (req.method === 'POST' && url.pathname === '/api/example') {
      const input = JSON.parse(await fs.readFile(at('examples', 'short.json'), 'utf8'));
      const files = new Set();
      walkPosts(input.post, p => { files.add(p.author.avatar); files.add(p.sourceScreenshot.file); p.media.forEach(m => files.add(m.file)); });
      const mapping = new Map();
      for (const file of files) {
        if (!file) continue;
        const bytes = await fs.readFile(path.resolve(at('examples'), file));
        const ext = path.extname(file); const dest = `${sha256(bytes)}${ext}`;
        await fs.writeFile(path.join(workspace, 'uploads', dest), bytes);
        mapping.set(file, `uploads/${dest}`);
      }
      walkPosts(input.post, p => { p.author.avatar = mapping.get(p.author.avatar); p.sourceScreenshot.file = mapping.get(p.sourceScreenshot.file); p.media.forEach(m => { m.file = mapping.get(m.file); }); });
      return send(res, 200, input);
    }
    if (req.method === 'POST' && url.pathname === '/api/render') {
      if (busy) return send(res, 409, { error: '正在渲染，请等待当前任务完成。' });
      busy = true;
      try {
        const { input, mode } = JSON.parse((await readBody(req)).toString('utf8'));
        const result = await renderer.render(input, { baseDir: workspace, outputDir: at('outputs'), mode, allowedRoot: workspace });
        const job = path.basename(result.dir);
        jobs.set(job, result.dir);
        const link = (name, download = false) => `/api/output?job=${encodeURIComponent(job)}&name=${encodeURIComponent(name)}${download ? '&download=1' : ''}`;
        return send(res, 200, { report: result.report, directory: result.dir,
          png: result.report.png ? link(result.report.png.file) : null,
          downloadPng: result.report.png ? link(result.report.png.file, true) : null,
          bundle: link(`${result.basename}.bundle.zip`, true),
          input: link(`${result.basename}.input.json`, true), reportJson: link(result.reportName, true), reportText: link(`${result.basename}.report.txt`, true) });
      } finally { busy = false; }
    }
    if (req.method === 'GET' && url.pathname === '/api/output') {
      const dir = jobs.get(url.searchParams.get('job'));
      const name = url.searchParams.get('name');
      if (!dir || !name || path.basename(name) !== name || !/\.(png|json|txt|zip)$/.test(name)) return send(res, 404, { error: '输出不存在。' });
      return await serveFile(res, path.join(dir, name), url.searchParams.has('download'));
    }
    return send(res, 404, { error: '未找到。' });
  } catch (e) { if (!res.headersSent) send(res, 400, { error: e.message }); else res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}\nFiles: ${ROOT}\n仅本地监听；Ctrl+C 停止。`));
async function shutdown() { server.close(); await renderer.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
