# 本机运行

安装 Node.js 24+，在源码目录执行 `npm ci`、`npm run setup`，然后 `npm run doctor` 和 `npm start`。Windows 可双击安装和启动脚本。首次下载依赖需要网络，排版本身在本机执行；退出终端即停止。

打开 `http://127.0.0.1:4317`。上传区为 `workspace`，导出为 `outputs`，浏览器/缓存/预检为 `runtime`，测试结果为 `test-results`。程序不注册服务、不做公网监听、不需要账号或密钥。

Linux 的用户目录离线包构建见 [OFFLINE_LINUX.md](OFFLINE_LINUX.md)。
