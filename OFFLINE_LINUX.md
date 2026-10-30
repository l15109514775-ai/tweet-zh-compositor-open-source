# Debian 13 amd64 离线构建

此公开仓库包含完整构建脚本，不提供私人版本的第三方二进制附件。目标为 Debian 13 amd64/x86_64、glibc 2.41。构建机需要网络、Python 3.11+、Node/npm；生成包在目标用户目录运行，不要求 sudo、容器或运行时联网安装。

```sh
npm ci
node offline/fetch-sources.mjs /absolute/cache
python scripts/build-linux-offline.py --work /absolute/new-build --cache /absolute/cache
```

脚本单独安装 Linux GNU 原生模块，下载 Node 24.22.1、Chromium 156.0.8078.4 revision 1248、FFmpeg、Debian 库和字体，检查来源哈希、ELF 架构、依赖名闭包和链接目标。不会把当前 Windows node_modules 复制为 Linux 依赖。

生成的 `tweet-zh-compositor-0.1.3-debian13-amd64-offline.tar.gz` 和同名 `.sha256` 放在构建目录，包含启动、渲染、自检脚本和文件清单。目标机器运行：

```sh
sha256sum -c tweet-zh-compositor-0.1.3-debian13-amd64-offline.tar.gz.sha256
tar -xzf tweet-zh-compositor-0.1.3-debian13-amd64-offline.tar.gz
cd tweet-zh-compositor-0.1.3-debian13-amd64-offline
./self-check.sh
./test-offline.sh
./start.sh
```

静态构建检查不等于目标系统实机通过。请断网验证实际 PNG、22 项自动测试和网页操作。再分发第三方运行时前，按 [第三方声明](THIRD_PARTY_NOTICES.md) 核对各自许可和源码提供义务。
