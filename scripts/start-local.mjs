import { checkLocal } from './check-local.mjs';
try {
  console.log('正在检查本机字体、锁定浏览器和 PNG 导出……');
  const check = await checkLocal();
  console.log(`本机出图预检通过：Chromium ${check.chromium}，PNG ${check.width}×${check.height}`);
  await import('../src/server.mjs');
} catch (e) {
  console.error(`本机启动未完成：${e.message}`);
  console.error('首次使用请运行“安装依赖.cmd”，或执行 npm ci 和 npm run setup。');
  process.exitCode = 1;
}
