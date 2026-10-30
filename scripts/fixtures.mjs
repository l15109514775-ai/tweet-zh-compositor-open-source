import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { at } from '../src/paths.mjs';
export async function createFixtures() {
  const dir = at('examples');
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  async function pattern(name, width, height, seed) {
    const bytes = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const border = x < 10 || y < 10 || x >= width - 10 || y >= height - 10;
      bytes[i] = border ? 18 : (Math.floor(x / 40) * 31 + seed * 29) % 230;
      bytes[i + 1] = border ? 28 : (Math.floor(y / 40) * 43 + seed * 59) % 230;
      bytes[i + 2] = border ? 38 : ((Math.floor(x / 80) + Math.floor(y / 80)) % 2 ? 230 : 110);
    }
    await sharp(bytes, { raw: { width, height, channels: 3 } }).png().toFile(path.join(dir, 'assets', name));
  }
  await pattern('test-avatar.png', 128, 128, 1);
  await pattern('test-source-not-real.png', 1280, 540, 2);
  for (const [i, w, h] of [[1, 640, 360], [2, 600, 800], [3, 960, 540], [4, 500, 500]]) await pattern(`test-media-${i}.png`, w, h, i + 3);
  function base(id) {
    return { schemaVersion: 1, testFixture: true, displayTimezone: 'Asia/Tokyo', post: {
      id: String(id), url: `https://x.com/layout_test/status/${id}`,
      author: { name: '测试作者🐉🌪️', handle: 'layout_test', avatar: 'assets/test-avatar.png', verified: false, verificationEvidence: null },
      originalText: 'これはテスト文章です。実在の投稿ではありません。',
      translation: '今天让我休息一天吧🙇\n恢复体力，明天会直播！',
      publishedAt: '2026-10-29T20:29:00+09:00', sourceTimezone: 'Asia/Tokyo',
      sourceScreenshot: { file: 'assets/test-source-not-real.png', capturedAt: '2026-10-29T20:35:00+09:00', reviewed: true },
      sourceMediaCount: 0, sourceQuote: 'none', media: [], quote: null, relationship: { type: 'original' },
      metrics: {}, notes: [], review: { translationConfirmed: true, sourceConfirmed: true }
    } };
  }
  const media = count => Array.from({ length: count }, (_, i) => ({ file: `assets/test-media-${i + 1}.png`, completeness: 'complete', reviewed: true }));
  const short = base('1000000000000000001');
  const long = base('1000000000000000002');
  long.post.translation = '明天凌晨5点开始。\n' + Array.from({ length: 55 }, (_, i) => `第${i + 1}段：这是超长中文排版测试，保持固定字号与行距，完整保留标点、空格和换行。`).join('\n') + '\n结束。';
  const mixed = base('1000000000000000003');
  mixed.post.author.name = '日本語と中文のテスト作者🐉';
  mixed.post.author.handle = 'very_long_account_' + 'abcdefghij'.repeat(12);
  mixed.post.translation = '日本語のまま：配信は明日、朝5時から！\n中文：明天凌晨5点开播👩‍💻🐉🌪️🙇‍♂️🇯🇵🇨🇳 1️⃣\n原文中的“明天”保持原样。\nhttps://example.invalid/' + 'path'.repeat(65) + '\n特殊字符：<script>alert("测试")</script> & \'单引号\'。';
  mixed.post.notes = ['显示时区转换不改写正文中的相对时间。'];
  const three = base('1000000000000000004');
  three.post.translation = '【三图直播预告 · 测试】\n明天凌晨5点见！三张配图都保留完整画面与比例。';
  three.post.media = media(3); three.post.sourceMediaCount = 3;
  const quote = base('1000000000000000005');
  quote.post.translation = '【开播通知 · 测试】\n开播啦！引用的三图预告保留在下方。';
  quote.post.quote = structuredClone(three.post); quote.post.sourceQuote = 'present';
  const absent = base('1000000000000000006');
  absent.post.translation = '没有提供互动数字。\n回复、转推、喜欢、书签与浏览量应保持留空。';
  delete absent.post.metrics;
  const cases = { short, long, mixed, 'three-media': three, 'quote-three-media': quote, 'missing-metrics': absent };
  for (const [name, data] of Object.entries(cases)) await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'batch.json'), JSON.stringify(Object.values(cases), null, 2) + '\n');
  const reference = base('1000000000000000099');
  await sharp(at('reference', 'mvp.jpg')).extract({ left: 38, top: 28, width: 102, height: 102 }).png().toFile(path.join(dir, 'assets', 'reference-avatar-crop.png'));
  reference.post.author = { name: '排版示例🐉🌪️', handle: 'layout_demo', avatar: 'assets/reference-avatar-crop.png', verified: true, verificationEvidence: '仅用于自制公开示例，不对应任何真实账号。' };
  reference.post.originalText = '（自制排版示例，不是真实原帖或译文。）';
  reference.post.translation = '这是公开排版演示，不是真实推文🙇\n保持字号与行距，长文只增加高度。';
  reference.post.metrics = { views: '1.2万', replies: 12, reposts: 3, likes: 45, bookmarks: 2 };
  reference.post.sourceScreenshot.file = '../reference/mvp.jpg';
  reference.post.notes = [];
  await fs.writeFile(path.join(dir, 'reference-layout-test.json'), JSON.stringify(reference, null, 2) + '\n');
  return { cases, reference };
}
if (process.argv[1] && path.resolve(process.argv[1]) === at('scripts', 'fixtures.mjs')) {
  await createFixtures(); console.log('Six explicit test fixtures generated. No real post/source data is asserted.');
}
